/**
 * server/beats/match.js — cosine match of a user's beat against the
 * articles corpus. Reuses the same HNSW index that powers QA retrieval.
 */

import { ensureDatabase } from '../storage.js';
import { readBeatProfileWithEmbedding } from './profile.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_MIN_SIMILARITY = 0.5;
const DEFAULT_WINDOW_HOURS = 168;

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
 * Return top-N articles matching the user's beat embedding.
 * Returns [] when the user has no beat, the embedding column is missing,
 * or no articles cross the similarity threshold.
 */
export async function matchBeatForUser({
  userId,
  limit = DEFAULT_LIMIT,
  minSimilarity = DEFAULT_MIN_SIMILARITY,
  windowHours = DEFAULT_WINDOW_HOURS,
  sinceIso = null,
} = {}) {
  if (!userId) return [];
  const profile = await readBeatProfileWithEmbedding(userId);
  if (!profile || !profile.embedding) return [];

  const lim = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));
  const params = [profile.embedding, lim];
  let idx = 3;
  const conditions = ['a.embedding IS NOT NULL'];

  const cutoff = sinceIso
    ? new Date(sinceIso).toISOString()
    : (windowHours > 0
        ? new Date(Date.now() - windowHours * 3600 * 1000).toISOString()
        : null);
  if (cutoff) {
    conditions.push(`a."publishedAt" >= $${idx}`);
    params.push(cutoff);
    idx += 1;
  }

  const sql = `
    SELECT
      a.id,
      a.title,
      a.url,
      a.source,
      a."isoA2",
      a."publishedAt",
      a.payload,
      ea."eventId" AS event_id,
      1 - (a.embedding <=> $1::vector) AS similarity
      FROM articles a
      LEFT JOIN event_articles ea ON ea."articleId" = a.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.embedding <=> $1::vector
      LIMIT $2
  `;

  const db = await ensureDatabase();
  const { rows } = await db.query(sql, params);
  return rows
    .filter((r) => Number(r.similarity) >= minSimilarity)
    .map((r) => ({
      articleId: r.id,
      eventId: r.event_id || null,
      title: r.title,
      source: r.source || '',
      url: r.url || null,
      region: r.isoA2 || null,
      publishedAt: r.publishedAt || null,
      excerpt: buildExcerpt(r),
      similarity: Number(r.similarity),
    }));
}

export const __test__ = { buildExcerpt };
