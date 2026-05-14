/**
 * server/ai/homePc.js — HTTP client for the home PC FastAPI inference service.
 *
 * The actual deployment is set up via the Hermes prompt in the design doc;
 * once URLs and bearer tokens are populated, this client speaks the API
 * defined in section C4 of the plan.
 *
 * Day-1: throws a typed "not_configured" error when env vars are missing,
 * which the client.js facade treats as a primary failure and routes the
 * request to the Workers AI fallback.
 */

const HOMEPC_URL = process.env.MAPR_AI_HOMEPC_URL || '';
const HOMEPC_LLM_URL = process.env.MAPR_AI_HOMEPC_LLM_URL || HOMEPC_URL;
const HOMEPC_EMBED_URL = process.env.MAPR_AI_HOMEPC_EMBED_URL || HOMEPC_URL;
const BEARER = process.env.MAPR_AI_HOMEPC_BEARER || '';
const CF_ACCESS_ID = process.env.MAPR_AI_CF_ACCESS_ID || '';
const CF_ACCESS_SECRET = process.env.MAPR_AI_CF_ACCESS_SECRET || '';

function notConfigured(detail) {
  const err = new Error(`home-pc ai not configured: ${detail}`);
  err.code = 'AI_HOMEPC_NOT_CONFIGURED';
  return err;
}

function authHeaders() {
  const h = { 'content-type': 'application/json' };
  if (BEARER) h['x-mapr-token'] = BEARER;
  if (CF_ACCESS_ID) h['cf-access-client-id'] = CF_ACCESS_ID;
  if (CF_ACCESS_SECRET) h['cf-access-client-secret'] = CF_ACCESS_SECRET;
  return h;
}

function summarizeHttpErrorBody(text = '') {
  const body = String(text || '').trim();
  if (!body) return '';
  if (/^<!doctype html/i.test(body) || /^<html[\s>]/i.test(body)) {
    return 'upstream returned an HTML error page';
  }
  return body
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

async function call(url, body, { timeoutMs = 30_000 } = {}) {
  if (!url) throw notConfigured('missing MAPR_AI_HOMEPC_URL');
  if (!BEARER) throw notConfigured('missing MAPR_AI_HOMEPC_BEARER');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const summary = summarizeHttpErrorBody(text);
      const detail = summary ? `: ${summary}` : '';
      const err = new Error(`home-pc HTTP ${res.status}${detail}`);
      err.code = 'AI_HOMEPC_HTTP_ERROR';
      err.status = res.status;
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function embed(req, opts = {}) {
  return call(`${HOMEPC_EMBED_URL}/embed`, req, opts);
}

export function ner(req, opts = {}) {
  return call(`${HOMEPC_EMBED_URL}/ner`, req, opts);
}

export function generate(req, opts = {}) {
  return call(`${HOMEPC_LLM_URL}/generate`, req, opts);
}

export async function healthz() {
  if (!HOMEPC_EMBED_URL) throw notConfigured('missing MAPR_AI_HOMEPC_URL');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${HOMEPC_EMBED_URL}/healthz`, {
      headers: authHeaders(),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = new Error(`home-pc healthz HTTP ${res.status}`);
      err.code = 'AI_HOMEPC_HTTP_ERROR';
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const __test__ = { summarizeHttpErrorBody };
