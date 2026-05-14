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

function vectorLiteral(vec) {
  if (!Array.isArray(vec) || !vec.length) {
    throw new Error('retrieve: empty embedding vector from AI worker');
  }
  return `[${vec.map((v) => Number(v).toFixed(6)).join(',')}]`;
}

function parsePayload(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function buildExcerpt(article) {
  const payload = parsePayload(article.payload);
  const summary = String(payload.summary || '').trim();
  if (summary) return summary.slice(0, 280);
  return String(article.title || '').slice(0, 280);
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
} = {}) {
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) return [];
  const limit = Math.max(1, Math.min(MAX_K, Number(k) || DEFAULT_K));

  const embedRes = await aiEmbed({ inputs: [cleanQuestion], normalize: true });
  const vec = embedRes?.vectors?.[0];
  if (!Array.isArray(vec) || vec.length === 0) {
    return [];
  }
  const literal = vectorLiteral(vec);

  const db = await ensureDatabase();
  const params = [literal, limit];
  let idx = 3;
  const conditions = ['a.embedding IS NOT NULL'];

  if (timeWindowHours && Number.isFinite(timeWindowHours) && timeWindowHours > 0) {
    const cutoff = new Date(Date.now() - timeWindowHours * 3600 * 1000).toISOString();
    conditions.push(`a."publishedAt" >= $${idx}`);
    params.push(cutoff);
    idx += 1;
  }
  if (region) {
    conditions.push(`a."isoA2" = $${idx}`);
    params.push(String(region).toUpperCase());
    idx += 1;
  }

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
      1 - (a.embedding <=> $1::vector) AS similarity
      FROM articles a
      LEFT JOIN event_articles ea ON ea."articleId" = a.id
      ${whereSql}
      ORDER BY a.embedding <=> $1::vector
      LIMIT $2
  `;

  let rows = [];
  try {
    const result = await db.query(sql, params);
    rows = result.rows;
  } catch (err) {
    // Host may have booted without pgvector or before the backfill ran.
    // ensureSchema makes a best-effort attempt to install both; if that
    // failed (e.g. the postgres image doesn't ship pgvector), the column
    // won't exist and this query fails with 42703 (undefined_column) or
    // 42704 (undefined_object for the vector type cast). Either way the
    // right user-facing behavior is "no matches" rather than 500.
    const code = err?.code || '';
    if (code === '42703' || code === '42704' || /column .*embedding.* does not exist/i.test(err.message)) {
      console.warn('[qa.retrieve] embedding column unavailable, returning no matches');
      return [];
    }
    throw err;
  }
  return rows
    .filter((row) => Number(row.similarity) >= minSimilarity)
    .map((row) => ({
      articleId: row.id,
      eventId: row.event_id || null,
      title: row.title,
      source: row.source || '',
      url: row.url || null,
      excerpt: buildExcerpt(row),
      similarity: Number(row.similarity),
      publishedAt: row.publishedAt || null,
    }));
}

export const __test__ = { vectorLiteral, buildExcerpt };
