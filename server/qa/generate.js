/**
 * server/qa/generate.js — orchestrates one Q&A LLM call.
 *
 * Given a user question + a set of retrieved citation candidates +
 * the conversation's recent message history, builds a structured input
 * for the ai-worker `/generate` endpoint, validates the output against
 * the qa schema, and enriches each citation with the article/event
 * metadata the client needs to render an inline link.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generate as aiGenerate } from '../ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QA_SCHEMA = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'ai', 'schemas', 'qa.schema.json'), 'utf8'),
);

const MAX_PRIOR_MESSAGES = 4;          // includes both user + assistant turns
const MAX_QUESTION_CHARS = 4000;
const MAX_EXCERPT_PER_CITATION = 220;
const MAX_QA_CITATIONS = 4;
const DEFAULT_QA_MAX_TOKENS = 384;
const DEFAULT_QA_GENERATE_TIMEOUT_MS = 45_000;

function clamp(s, n) { return String(s || '').slice(0, n); }

function normalizeConversationText(question) {
  return String(question || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'?]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldBypassCorpusRetrieval(question) {
  const cleaned = normalizeConversationText(question);
  if (!cleaned || cleaned.length > 80) return false;
  return /^(hi|hello|hey|yo|howdy|good morning|good afternoon|good evening|thanks|thank you|thx|cheers|ok|okay|cool|got it|how are you\??)$/.test(cleaned);
}

function trimPriorMessages(messages = []) {
  if (!messages.length) return [];
  return messages
    .slice(-MAX_PRIOR_MESSAGES)
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: clamp(m.content, 500),
    }));
}

function trimRetrieved(retrieved = []) {
  return retrieved.slice(0, MAX_QA_CITATIONS).map((r, i) => ({
    index: i + 1,
    articleId: r.articleId,
    title: clamp(r.title, 200),
    source: clamp(r.source, 80),
    publishedAt: r.publishedAt || null,
    eventTitle: r.eventTitle ? clamp(r.eventTitle, 220) : null,
    eventCountry: r.eventCountry ? clamp(r.eventCountry, 80) : null,
    eventCategory: r.eventCategory ? clamp(r.eventCategory, 80) : null,
    retrievalMode: r.retrievalMode || null,
    excerpt: clamp(r.excerpt, MAX_EXCERPT_PER_CITATION),
  }));
}

function buildInput({ question, retrieved, priorMessages }) {
  const citations = trimRetrieved(retrieved);
  const evidenceInstruction = citations.length
    ? 'Answer using ONLY the provided Mapr corpus citations.'
    : 'No Mapr corpus citations were retrieved for this turn. For factual questions, do not answer from model memory; explain the evidence gap and ask for a narrower Mapr corpus question. For non-factual conversational messages, respond naturally without inventing facts.';
  return {
    question: clamp(question, MAX_QUESTION_CHARS),
    prior_messages: trimPriorMessages(priorMessages),
    citations,
    current_date: new Date().toISOString().slice(0, 10),
    instructions: [
      evidenceInstruction,
      'Do not use general world knowledge or model training data to fill gaps.',
      'When citations are available, reference sources inline with [1], [2]… matching the citations array.',
      'If the citations do not cover the question, say exactly what is missing.',
      'Keep the answer concise: a short bottom line first, then compact bullets only when useful.',
      'Do not include uncited factual claims.',
    ].join(' '),
  };
}

function coerceOutput(raw) {
  // The home-PC worker already enforces the schema via Ollama JSON mode,
  // but the Workers AI fallback might return a slightly looser shape.
  // Coerce defensively rather than throw on minor noise.
  if (!raw || typeof raw !== 'object') {
    return { answer: '', citations: [] };
  }
  const answer = typeof raw.answer === 'string' ? raw.answer : '';
  const cites = Array.isArray(raw.citations) ? raw.citations : [];
  return {
    answer,
    citations: cites
      .filter((c) => c && typeof c.articleId === 'string')
      .slice(0, 12)
      .map((c, i) => ({
        index: i + 1,
        articleId: c.articleId,
        quote: typeof c.quote === 'string' ? clamp(c.quote, 240) : null,
      })),
  };
}

/**
 * Enrich citations with article/event metadata pulled from `retrieved`
 * (the candidates we sent into the prompt). If the LLM cites an id that
 * wasn't in our retrieved set we drop the citation — we never invent
 * articles that didn't come from the corpus.
 */
function enrichCitations(rawCitations, retrieved) {
  const byId = new Map(retrieved.map((r) => [r.articleId, r]));
  const out = [];
  let nextIndex = 1;
  for (const cite of rawCitations) {
    const meta = byId.get(cite.articleId);
    if (!meta) continue;
    out.push({
      index: nextIndex,
      articleId: meta.articleId,
      eventId: meta.eventId || null,
      title: meta.title,
      source: meta.source || '',
      url: meta.url || null,
      quote: cite.quote || null,
    });
    nextIndex += 1;
  }
  return out;
}

function aiGenerateError(err) {
  const message = err?.message || 'AI generation failed';
  const out = err instanceof Error ? err : new Error(message);
  out.statusCode = err?.statusCode || 502;
  out.code = err?.code || 'AI_GENERATE_FAILED';
  return out;
}

function badModelOutputError(message) {
  return Object.assign(new Error(message), {
    statusCode: 502,
    code: 'AI_BAD_QA_OUTPUT',
  });
}

/**
 * Public entry. Returns { answer, citations, modelUsed, tokensIn, tokensOut }.
 * Throws when the AI adapter is unconfigured — the caller maps to 503.
 */
export async function generateAnswer(
  { question, retrieved = [], priorMessages = [] } = {},
  { generate = aiGenerate } = {},
) {
  if (!question || !String(question).trim()) {
    throw Object.assign(new Error('question required'), { statusCode: 400 });
  }
  const input = buildInput({ question, retrieved, priorMessages });
  let result;
  try {
    result = await generate({
      task: 'qa',
      input,
      schema: QA_SCHEMA,
      maxTokens: Number(process.env.MAPR_AI_QA_MAX_TOKENS || DEFAULT_QA_MAX_TOKENS),
      temperature: 0.2,
      timeoutMs: Number(process.env.MAPR_AI_QA_GENERATE_TIMEOUT_MS || DEFAULT_QA_GENERATE_TIMEOUT_MS),
    });
  } catch (err) {
    throw aiGenerateError(err);
  }
  const coerced = coerceOutput(result?.output);
  const citations = enrichCitations(coerced.citations, retrieved);
  if (!coerced.answer.trim()) {
    throw badModelOutputError('AI response did not include an answer');
  }
  if (retrieved.length > 0 && citations.length === 0) {
    throw badModelOutputError('AI response did not include supported citations');
  }
  return {
    answer: coerced.answer.trim(),
    citations,
    modelUsed: result?.model || 'unknown',
    tokensIn: result?.tokens_in ?? null,
    tokensOut: result?.tokens_out ?? null,
  };
}

export const __test__ = {
  trimPriorMessages,
  trimRetrieved,
  shouldBypassCorpusRetrieval,
  buildInput,
  coerceOutput,
  enrichCitations,
  aiGenerateError,
  badModelOutputError,
  DEFAULT_QA_MAX_TOKENS,
  DEFAULT_QA_GENERATE_TIMEOUT_MS,
};

export { shouldBypassCorpusRetrieval };
