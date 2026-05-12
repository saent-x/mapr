/**
 * server/ai/client.js — facade for AI inference (embed / ner / generate).
 *
 * Routes requests to the primary backend (home PC over Cloudflare Tunnel)
 * with an automatic fallback to Cloudflare Workers AI on timeout, error,
 * or unhealthy probe. Day-1: backends are stubbed so callers compile cleanly;
 * the home PC service and Workers AI binding are wired in Sprint C.
 *
 * Env vars consulted:
 *   MAPR_AI_HOMEPC_URL          — base URL for home-pc service (FastAPI)
 *   MAPR_AI_HOMEPC_BEARER       — shared bearer token (X-Mapr-Token)
 *   MAPR_AI_CF_ACCESS_ID        — Cloudflare Access service token id
 *   MAPR_AI_CF_ACCESS_SECRET    — Cloudflare Access service token secret
 *   MAPR_AI_WORKERSAI_ACCOUNT   — Cloudflare account id (for fallback)
 *   MAPR_AI_WORKERSAI_TOKEN     — Cloudflare API token with Workers AI scope
 *   MAPR_AI_GENERATE_TIMEOUT_MS — default 45000
 *   MAPR_AI_EMBED_TIMEOUT_MS    — default 12000
 */

import * as homePc from './homePc.js';
import * as workersAi from './workersAi.js';

const CONFIG = {
  generateTimeoutMs: Number(process.env.MAPR_AI_GENERATE_TIMEOUT_MS || 45_000),
  embedTimeoutMs: Number(process.env.MAPR_AI_EMBED_TIMEOUT_MS || 12_000),
  // Circuit-breaker state. Opens after N consecutive failures and stays open
  // until cooldown elapses; while open, all traffic is routed to the fallback.
  failureThreshold: 3,
  cooldownMs: 60_000,
};

const breaker = {
  consecutiveFailures: 0,
  openedAt: 0,
};

function breakerOpen() {
  if (!breaker.openedAt) return false;
  if (Date.now() - breaker.openedAt > CONFIG.cooldownMs) {
    breaker.openedAt = 0;
    breaker.consecutiveFailures = 0;
    return false;
  }
  return true;
}

function recordSuccess() {
  breaker.consecutiveFailures = 0;
  breaker.openedAt = 0;
}

function recordFailure() {
  breaker.consecutiveFailures += 1;
  if (breaker.consecutiveFailures >= CONFIG.failureThreshold) {
    breaker.openedAt = Date.now();
  }
}

async function callWithFallback(primary, fallback, label) {
  if (breakerOpen()) {
    return fallback();
  }
  try {
    const out = await primary();
    recordSuccess();
    return out;
  } catch (err) {
    recordFailure();
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[ai.${label}] primary failed, trying fallback:`, err.message);
    }
    return fallback();
  }
}

/**
 * Generate text completion against a JSON schema.
 * @param {object} req
 * @param {('brief'|'thread_diff'|'credibility_explain')} req.task
 * @param {object} req.input
 * @param {object} [req.schema]
 * @param {number} [req.maxTokens]
 * @param {number} [req.temperature]
 */
export function generate(req) {
  return callWithFallback(
    () => homePc.generate(req, { timeoutMs: CONFIG.generateTimeoutMs }),
    () => workersAi.generate(req),
    'generate',
  );
}

/**
 * Embed one or more strings into vectors (1024-dim, bge-m3 space).
 * @param {object} req
 * @param {string[]} req.inputs
 * @param {boolean} [req.normalize=true]
 */
export function embed(req) {
  return callWithFallback(
    () => homePc.embed(req, { timeoutMs: CONFIG.embedTimeoutMs }),
    () => workersAi.embed(req),
    'embed',
  );
}

/**
 * Run NER over text.
 * @param {object} req
 * @param {string} req.text
 * @param {string} [req.lang='auto']
 */
export function ner(req) {
  return callWithFallback(
    () => homePc.ner(req, { timeoutMs: CONFIG.embedTimeoutMs }),
    () => workersAi.ner(req),
    'ner',
  );
}

export function getBreakerState() {
  return {
    open: breakerOpen(),
    consecutiveFailures: breaker.consecutiveFailures,
    openedAt: breaker.openedAt,
  };
}

export const __test__ = { breaker, CONFIG };
