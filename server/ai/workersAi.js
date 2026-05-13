/**
 * server/ai/workersAi.js — Cloudflare Workers AI fallback adapter.
 *
 * Models used (see plan §C9):
 *   - LLM:        @cf/meta/llama-3.1-8b-instruct (JSON schema mode)
 *   - Embeddings: @cf/baai/bge-m3                 (1024-dim, multilingual)
 *   - NER:        no equivalent → throws AI_NER_UNAVAILABLE so the caller can
 *                 fall back to compromise.js heuristics during a home-PC outage.
 *
 * Day-1: implementations throw "not_configured" when env vars are missing.
 * Once MAPR_AI_WORKERSAI_ACCOUNT / MAPR_AI_WORKERSAI_TOKEN are populated, the
 * real implementation hits https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/{model}.
 */

const CF_ACCOUNT = process.env.MAPR_AI_WORKERSAI_ACCOUNT || '';
const CF_TOKEN = process.env.MAPR_AI_WORKERSAI_TOKEN || '';
const LLM_MODEL = process.env.MAPR_AI_WORKERSAI_LLM || '@cf/meta/llama-3.1-8b-instruct';
const EMBED_MODEL = process.env.MAPR_AI_WORKERSAI_EMBED || '@cf/baai/bge-m3';

function notConfigured(detail) {
  const err = new Error(`workers-ai not configured: ${detail}`);
  err.code = 'AI_WORKERSAI_NOT_CONFIGURED';
  return err;
}

async function callWorkersAi(model, body, { timeoutMs = 30_000 } = {}) {
  if (!CF_ACCOUNT) throw notConfigured('missing MAPR_AI_WORKERSAI_ACCOUNT');
  if (!CF_TOKEN) throw notConfigured('missing MAPR_AI_WORKERSAI_TOKEN');
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/${model}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${CF_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`workers-ai HTTP ${res.status}: ${text.slice(0, 200)}`);
      err.code = 'AI_WORKERSAI_HTTP_ERROR';
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    if (json.success === false) {
      const err = new Error(`workers-ai error: ${JSON.stringify(json.errors).slice(0, 200)}`);
      err.code = 'AI_WORKERSAI_API_ERROR';
      throw err;
    }
    return json.result ?? json;
  } finally {
    clearTimeout(timer);
  }
}

export async function generate(req) {
  // Translates our generic generate() request into Workers AI's chat format.
  const messages = [
    { role: 'system', content: 'You are an analyst assistant. Respond strictly per the provided JSON schema. No prose.' },
    { role: 'user', content: JSON.stringify({ task: req.task, input: req.input }) },
  ];
  const payload = {
    messages,
    max_tokens: req.maxTokens || 512,
    temperature: req.temperature ?? 0.3,
  };
  if (req.schema) payload.response_format = { type: 'json_schema', json_schema: req.schema };

  const result = await callWorkersAi(LLM_MODEL, payload);
  const raw = result?.response || result?.result?.response || '';
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); }
    catch { /* leave as string */ }
  }
  return {
    output: parsed,
    model: LLM_MODEL,
    tokens_in: result?.usage?.prompt_tokens,
    tokens_out: result?.usage?.completion_tokens,
  };
}

export async function embed({ inputs = [], normalize = true } = {}) {
  if (!inputs.length) return { vectors: [], model: EMBED_MODEL };
  const payload = { text: inputs };
  const result = await callWorkersAi(EMBED_MODEL, payload);
  let vectors = result?.data || result?.vectors || result?.response || [];
  if (normalize) {
    vectors = vectors.map((v) => {
      let n = 0;
      for (const x of v) n += x * x;
      const inv = n > 0 ? 1 / Math.sqrt(n) : 0;
      return v.map((x) => x * inv);
    });
  }
  return { vectors, model: EMBED_MODEL };
}

export async function ner() {
  const err = new Error('NER not available on Workers AI; fall back to compromise.js');
  err.code = 'AI_NER_UNAVAILABLE';
  throw err;
}
