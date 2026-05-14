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

const MAX_PRIOR_MESSAGES = 6;          // includes both user + assistant turns
const MAX_QUESTION_CHARS = 4000;
const MAX_EXCERPT_PER_CITATION = 360;

function clamp(s, n) { return String(s || '').slice(0, n); }

function trimPriorMessages(messages = []) {
  if (!messages.length) return [];
  return messages
    .slice(-MAX_PRIOR_MESSAGES)
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: clamp(m.content, 1200),
    }));
}

function trimRetrieved(retrieved = []) {
  return retrieved.slice(0, 8).map((r, i) => ({
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
  return {
    question: clamp(question, MAX_QUESTION_CHARS),
    prior_messages: trimPriorMessages(priorMessages),
    citations: trimRetrieved(retrieved),
    current_date: new Date().toISOString().slice(0, 10),
    instructions: [
      'Answer using ONLY the provided Mapr corpus citations.',
      'Do not use general world knowledge or model training data to fill gaps.',
      'Reference sources inline with [1], [2]… matching the citations array.',
      'If the citations do not cover the question, say exactly what is missing.',
      'Format for scanning: a short bottom line first, then compact bullets only when useful.',
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
        index: Number.isFinite(c.index) ? c.index : i + 1,
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
      index: cite.index || nextIndex,
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

function noContextAnswer() {
  return {
    answer: "I couldn't find enough Mapr corpus evidence to answer that. Try broadening the time window, turning off the current filter, or asking about a named place, event, source, or actor from the latest ingest.",
    citations: [],
    modelUsed: 'retrieval-only',
    tokensIn: 0,
    tokensOut: 0,
  };
}

function retrievalOnlyFallback(retrieved, modelUsed) {
  const rawCitations = retrieved.slice(0, 4).map((r, i) => ({
    index: i + 1,
    articleId: r.articleId,
  }));
  const citations = enrichCitations(rawCitations, retrieved);
  const lines = [
    "I found relevant Mapr corpus matches, but the model did not return a properly cited synthesis.",
    '',
    ...citations.map((c) => `- ${c.title}${c.source ? ` (${c.source})` : ''} [${c.index}]`),
  ];
  return {
    answer: lines.join('\n'),
    citations,
    modelUsed: `${modelUsed || 'unknown'}:citation-fallback`,
    tokensIn: null,
    tokensOut: null,
  };
}

/**
 * Public entry. Returns { answer, citations, modelUsed, tokensIn, tokensOut }.
 * Throws when the AI adapter is unconfigured — the caller maps to 503.
 */
export async function generateAnswer({ question, retrieved = [], priorMessages = [] } = {}) {
  if (!question || !String(question).trim()) {
    throw Object.assign(new Error('question required'), { statusCode: 400 });
  }
  if (!retrieved.length) {
    return noContextAnswer();
  }
  const input = buildInput({ question, retrieved, priorMessages });
  const result = await aiGenerate({
    task: 'qa',
    input,
    schema: QA_SCHEMA,
    maxTokens: 640,
    temperature: 0.2,
    timeoutMs: Number(process.env.MAPR_AI_QA_GENERATE_TIMEOUT_MS || 25_000),
  });
  const coerced = coerceOutput(result?.output);
  const citations = enrichCitations(coerced.citations, retrieved);
  if (!coerced.answer.trim() || citations.length === 0) {
    return retrievalOnlyFallback(retrieved, result?.model || 'unknown');
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
  buildInput,
  coerceOutput,
  enrichCitations,
  noContextAnswer,
  retrievalOnlyFallback,
};
