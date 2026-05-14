/**
 * server/qa/retrieve.js — top-k cosine retrieval over articles.embedding.
 *
 * The Mapr ingest pipeline writes a bge-m3 (1024-dim) embedding per
 * article into the `embedding vector(1024)` column. This module embeds
 * a user question via the same model, then runs an HNSW-backed cosine
 * search against the corpus and returns enriched citation candidates.
 */

import { embed as aiEmbed } from '../ai/client.js';
import { ensureDatabase } from '../storage.js';

const MAX_K = 16;
const DEFAULT_K = 8;
const DEFAULT_MIN_SIMILARITY = 0.3;
const DEFAULT_TIME_WINDOW_HOURS = 168;
const DEFAULT_LEXICAL_K = 6;
const MAX_TERMS = 8;
const SEARCH_STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'anything', 'before', 'between',
  'brief', 'briefing', 'could', 'current', 'does', 'from', 'happen',
  'happened', 'have', 'into', 'latest', 'more', 'news', 'recent',
  'report', 'reports', 'show', 'source', 'sources', 'that', 'their',
  'the', 'there', 'these', 'this', 'today', 'updates', 'what', 'when', 'where',
  'which', 'with', 'would',
]);

function vectorLiteral(vec) {
  if (!Array.isArray(vec) || !vec.length) {
    throw new Error('retrieve: empty embedding vector from AI worker');
  }
  return `[${vec.map((v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) {
      throw new Error('retrieve: non-finite embedding value from AI worker');
    }
    return n.toFixed(6);
  }).join(',')}]`;
}

function parsePayload(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function normalizeText(raw) {
  return String(raw || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function buildExcerpt(article) {
  const payload = parsePayload(article.payload);
  const candidates = [
    payload.summary,
    payload.description,
    payload.content,
    payload.body,
    payload.text,
    article.title,
  ];
  const excerpt = candidates.map(normalizeText).find(Boolean) || '';
  return excerpt.slice(0, 360);
}

function buildSearchTerms(question) {
  const seen = new Set();
  const matches = String(question || '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]{3,}/gu) || [];
  const terms = [];
  for (const raw of matches) {
    const term = raw.normalize('NFKC');
    if (SEARCH_STOPWORDS.has(term) || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

function addScopeFilters(conditions, params, { timeWindowHours, region }) {
  if (timeWindowHours && Number.isFinite(timeWindowHours) && timeWindowHours > 0) {
    const cutoff = new Date(Date.now() - timeWindowHours * 3600 * 1000).toISOString();
    conditions.push(`a."publishedAt" >= $${params.length + 1}`);
    params.push(cutoff);
  }
  if (region) {
    conditions.push(`a."isoA2" = $${params.length + 1}`);
    params.push(String(region).toUpperCase());
  }
}

function mapRetrievedRow(row, retrievalMode) {
  return {
    articleId: row.id,
    eventId: row.event_id || null,
    title: row.title,
    source: row.source || '',
    url: row.url || null,
    excerpt: buildExcerpt(row),
    similarity: row.similarity == null ? null : Number(row.similarity),
    lexicalScore: row.lexical_score == null ? null : Number(row.lexical_score),
    retrievalMode,
    publishedAt: row.publishedAt || null,
    eventTitle: row.event_title || null,
    eventCountry: row.event_country || null,
    eventCategory: row.event_category || null,
  };
}

async function retrieveSemantic(cleanQuestion, {
  limit,
  timeWindowHours,
  region,
  minSimilarity,
}) {
  const embedRes = await aiEmbed({
    inputs: [cleanQuestion],
    normalize: true,
    timeoutMs: Number(process.env.MAPR_AI_QA_EMBED_TIMEOUT_MS || 8_000),
  });
  const vec = embedRes?.vectors?.[0];
  if (!Array.isArray(vec) || vec.length === 0) {
    return [];
  }
  const literal = vectorLiteral(vec);

  const db = await ensureDatabase();
  const params = [literal, limit];
  const conditions = ['a.embedding IS NOT NULL'];
  addScopeFilters(conditions, params, { timeWindowHours, region });
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // pgvector cosine *distance* is `1 - cosine_similarity`. We select both so
  // the caller filters by similarity directly. Joining event_articles gives
  // us the parent event id when one exists; LEFT JOIN keeps stand-alone
  // articles in the result set.
  const sql = `
    SELECT
      a.id,
      a.title,
      a.url,
      a.source,
      a."publishedAt",
      a.payload,
      ea."eventId" AS event_id,
      e.title AS event_title,
      e."primaryCountry" AS event_country,
      e.category AS event_category,
      1 - (a.embedding <=> $1::vector) AS similarity
      FROM articles a
      LEFT JOIN event_articles ea ON ea."articleId" = a.id
      LEFT JOIN events e ON e.id = ea."eventId"
      ${whereSql}
      ORDER BY a.embedding <=> $1::vector
      LIMIT $2
  `;

  const { rows } = await db.query(sql, params);
  return rows
    .filter((row) => Number(row.similarity) >= minSimilarity)
    .map((row) => mapRetrievedRow(row, 'semantic'));
}

async function retrieveLexical(cleanQuestion, {
  limit,
  timeWindowHours,
  region,
}) {
  const terms = buildSearchTerms(cleanQuestion);
  if (!terms.length) return [];

  const params = [limit];
  const conditions = [];
  addScopeFilters(conditions, params, { timeWindowHours, region });

  const termPredicates = [];
  const scoreParts = [];
  for (const term of terms) {
    params.push(`%${term}%`);
    const p = `$${params.length}`;
    termPredicates.push(`(
      LOWER(a.title) LIKE ${p}
      OR LOWER(COALESCE(a.source, '')) LIKE ${p}
      OR LOWER(COALESCE(a.payload, '')) LIKE ${p}
      OR LOWER(COALESCE(e.title, '')) LIKE ${p}
      OR LOWER(COALESCE(e."primaryCountry", '')) LIKE ${p}
      OR LOWER(COALESCE(e.category, '')) LIKE ${p}
    )`);
    scoreParts.push(`(
      CASE WHEN LOWER(a.title) LIKE ${p} THEN 5 ELSE 0 END
      + CASE WHEN LOWER(COALESCE(e.title, '')) LIKE ${p} THEN 4 ELSE 0 END
      + CASE WHEN LOWER(COALESCE(a.source, '')) LIKE ${p} THEN 2 ELSE 0 END
      + CASE WHEN LOWER(COALESCE(e."primaryCountry", '')) LIKE ${p} THEN 2 ELSE 0 END
      + CASE WHEN LOWER(COALESCE(e.category, '')) LIKE ${p} THEN 2 ELSE 0 END
      + CASE WHEN LOWER(COALESCE(a.payload, '')) LIKE ${p} THEN 1 ELSE 0 END
    )`);
  }

  conditions.push(`(${termPredicates.join(' OR ')})`);
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT
      a.id,
      a.title,
      a.url,
      a.source,
      a."publishedAt",
      a.payload,
      ea."eventId" AS event_id,
      e.title AS event_title,
      e."primaryCountry" AS event_country,
      e.category AS event_category,
      (${scoreParts.join(' + ')}) AS lexical_score
      FROM articles a
      LEFT JOIN event_articles ea ON ea."articleId" = a.id
      LEFT JOIN events e ON e.id = ea."eventId"
      ${whereSql}
      ORDER BY lexical_score DESC, a."publishedAt" DESC NULLS LAST
      LIMIT $1
  `;

  const db = await ensureDatabase();
  const { rows } = await db.query(sql, params);
  return rows
    .filter((row) => Number(row.lexical_score) > 0)
    .map((row) => mapRetrievedRow(row, 'lexical'));
}

function mergeRetrieved(semanticRows, lexicalRows, limit) {
  const byId = new Map();
  const merged = [];
  const add = (row) => {
    if (!row?.articleId) return;
    const existing = byId.get(row.articleId);
    if (existing) {
      if (existing.retrievalMode !== row.retrievalMode) {
        existing.retrievalMode = 'hybrid';
        existing.lexicalScore = existing.lexicalScore ?? row.lexicalScore;
      }
      return;
    }
    const next = { ...row };
    byId.set(next.articleId, next);
    merged.push(next);
  };
  semanticRows.forEach(add);
  lexicalRows.forEach(add);
  return merged.slice(0, limit);
}

/**
 * Retrieve the top-K articles for a question.
 *
 * @param {string} question - User question (already authenticated).
 * @param {object} opts
 * @param {number}  [opts.k=8]                      number of rows to return (capped at 16)
 * @param {number}  [opts.timeWindowHours=168]      ignore articles older than this
 * @param {string?} [opts.region]                   optional ISO-A2 code to scope the search
 * @param {number}  [opts.minSimilarity=0.3]        drop rows below this cosine similarity
 * @returns {Promise<Array<{
 *   articleId: string,
 *   eventId: string | null,
 *   title: string,
 *   source: string,
 *   url: string | null,
 *   excerpt: string,
 *   similarity: number,
 *   publishedAt: string | null,
 * }>>}
 */
export async function retrieveTopK(question, {
  k = DEFAULT_K,
  timeWindowHours = DEFAULT_TIME_WINDOW_HOURS,
  region = null,
  minSimilarity = DEFAULT_MIN_SIMILARITY,
  lexicalK = DEFAULT_LEXICAL_K,
} = {}) {
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) return [];
  const limit = Math.max(1, Math.min(MAX_K, Number(k) || DEFAULT_K));
  const lexicalLimit = Math.max(0, Math.min(MAX_K, Number(lexicalK) || DEFAULT_LEXICAL_K));

  let semanticRows = [];
  let lexicalRows = [];
  let semanticError = null;
  let lexicalError = null;

  try {
    semanticRows = await retrieveSemantic(cleanQuestion, {
      limit,
      timeWindowHours,
      region,
      minSimilarity,
    });
  } catch (err) {
    semanticError = err;
  }

  if (lexicalLimit > 0) {
    try {
      lexicalRows = await retrieveLexical(cleanQuestion, {
        limit: lexicalLimit,
        timeWindowHours,
        region,
      });
    } catch (err) {
      lexicalError = err;
    }
  }

  const merged = mergeRetrieved(semanticRows, lexicalRows, limit);
  if (!merged.length && lexicalError) throw lexicalError;
  if (!merged.length && semanticError && lexicalLimit === 0) throw semanticError;
  return merged;
}

export const __test__ = {
  vectorLiteral,
  buildExcerpt,
  buildSearchTerms,
  mergeRetrieved,
};
