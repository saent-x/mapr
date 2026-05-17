/**
 * server/ai/gateway.js — single HTTP client Mapr backend uses for QA.
 *
 * Contract:
 *   POST /v1/qa
 *   GET  /healthz
 *   GET  /readyz
 *
 * The backend intentionally does not know about Ollama, embeddings, vector DB,
 * Redis, or internal AI worker URLs. All AI/RAG work for the QA flow happens
 * behind this gateway.
 */

const DEFAULT_TIMEOUT_MS = 55_000;

function resolveGatewayConfig(env = process.env) {
  return {
    url: (
      env.MAPR_AI_GATEWAY_URL
      || env.MAPR_AI_HOMEPC_QA_URL
      || env.MAPR_AI_HOMEPC_LLM_URL
      || env.MAPR_AI_HOMEPC_URL
      || ''
    ).replace(/\/+$/, ''),
    token: (
      env.MAPR_AI_GATEWAY_TOKEN
      || env.MAPR_AI_BEARER
      || env.MAPR_AI_HOMEPC_BEARER
      || ''
    ),
  };
}

function notConfigured(detail) {
  const err = new Error(`AI gateway not configured: ${detail}`);
  err.code = 'AI_NOT_CONFIGURED';
  err.statusCode = 503;
  return err;
}

function summarizeHttpErrorBody(text = '') {
  const body = String(text || '').trim();
  if (!body) return '';
  if (/^<!doctype html/i.test(body) || /^<html[\s>]/i.test(body)) {
    return 'upstream returned an HTML error page';
  }
  return body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function mapGatewayCode(status, payload) {
  const code = payload?.code || payload?.error?.code || payload?.detail?.code;
  if (code) return code;
  if (status === 429 || status === 503) return 'AI_BUSY';
  if (status === 504) return 'AI_TIMEOUT';
  return 'AI_UPSTREAM_ERROR';
}

async function callGateway(path, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const config = resolveGatewayConfig();
  if (!config.url) throw notConfigured('missing MAPR_AI_GATEWAY_URL');
  if (!config.token) throw notConfigured('missing MAPR_AI_GATEWAY_TOKEN');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.url}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-mapr-token': config.token,
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = null; }
    }
    if (!res.ok) {
      const summary = payload ? JSON.stringify(payload).slice(0, 500) : summarizeHttpErrorBody(text);
      const err = new Error(summary || `AI gateway HTTP ${res.status}`);
      err.statusCode = res.status;
      err.code = mapGatewayCode(res.status, payload);
      err.payload = payload;
      throw err;
    }
    return payload ?? {};
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error('AI gateway request timed out');
      e.code = 'AI_TIMEOUT';
      e.statusCode = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function qa(req) {
  return callGateway('/v1/qa', {
    method: 'POST',
    body: req,
    timeoutMs: Number(req?.timeoutMs || process.env.MAPR_AI_QA_GATEWAY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  });
}

export function healthz() {
  return callGateway('/healthz');
}

export function readyz() {
  return callGateway('/readyz');
}

export const __test__ = { summarizeHttpErrorBody, mapGatewayCode, resolveGatewayConfig };
