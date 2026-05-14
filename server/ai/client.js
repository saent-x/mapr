/**
 * server/ai/client.js — facade for AI inference (embed / ner / generate).
 *
 * Single backend: the home-PC FastAPI service over Cloudflare Tunnel.
 * Errors surface to the caller — there is no automatic fallback.
 *
 * Env vars consulted:
 *   MAPR_AI_HOMEPC_URL          — base URL for home-pc service (FastAPI)
 *   MAPR_AI_HOMEPC_LLM_URL      — LLM endpoint (overrides _URL for /generate)
 *   MAPR_AI_HOMEPC_EMBED_URL    — embed endpoint (overrides _URL for /embed, /ner)
 *   MAPR_AI_HOMEPC_BEARER       — shared bearer token (X-Mapr-Token)
 *   MAPR_AI_CF_ACCESS_ID        — Cloudflare Access service token id
 *   MAPR_AI_CF_ACCESS_SECRET    — Cloudflare Access service token secret
 *   MAPR_AI_GENERATE_TIMEOUT_MS — default 120000 (covers Ollama cold-start)
 *   MAPR_AI_EMBED_TIMEOUT_MS    — default 30000
 */

import * as homePc from './homePc.js';

const CONFIG = {
  generateTimeoutMs: Number(process.env.MAPR_AI_GENERATE_TIMEOUT_MS || 120_000),
  embedTimeoutMs: Number(process.env.MAPR_AI_EMBED_TIMEOUT_MS || 30_000),
};

/**
 * Generate text completion against a JSON schema.
 * @param {object} req
 * @param {('brief'|'thread_diff'|'credibility_explain'|'qa')} req.task
 * @param {object} req.input
 * @param {object} [req.schema]
 * @param {number} [req.maxTokens]
 * @param {number} [req.temperature]
 */
export function generate(req) {
  const timeoutMs = Number(req?.timeoutMs || CONFIG.generateTimeoutMs);
  const { timeoutMs: _ignore, ...body } = req || {};
  return homePc.generate(body, { timeoutMs });
}

/**
 * Embed one or more strings into vectors (1024-dim, bge-m3 space).
 */
export function embed(req) {
  const timeoutMs = Number(req?.timeoutMs || CONFIG.embedTimeoutMs);
  const { timeoutMs: _ignore, ...body } = req || {};
  return homePc.embed(body, { timeoutMs });
}

/**
 * Run NER over text.
 */
export function ner(req) {
  return homePc.ner(req, { timeoutMs: CONFIG.embedTimeoutMs });
}

export const __test__ = { CONFIG };
