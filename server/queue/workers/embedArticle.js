/**
 * embed-article worker — embeds article titles (and short summaries when
 * present) using server/ai/client.embed(), writes the vector + model name
 * into articles.embedding / .embedding_model / .embedded_at.
 *
 * Job data:
 *   { articleId }            single article
 *   { articleIds: [...] }    batched up to 32
 *
 * No-op for articles that already have a fresh embedding (same model
 * stamped) — the queue is safe to re-enqueue.
 */

import { ensureDatabase } from '../../storage.js';
import { embed as aiEmbed } from '../../ai/client.js';

const BATCH_LIMIT = 32;
const MAX_TEXT_LEN = 1600;

function buildText(row) {
  const title = String(row.title || '').trim();
  let payload;
  try { payload = row.payload ? JSON.parse(row.payload) : null; }
  catch { payload = null; }
  const summary = String((payload && payload.summary) || '').trim();
  return (title + (summary ? '\n\n' + summary : '')).slice(0, MAX_TEXT_LEN);
}

async function loadArticleRows(db, ids) {
  if (!ids?.length) return [];
  const { rows } = await db.query(
    `SELECT id, title, payload, embedding_model
       FROM articles
      WHERE id = ANY($1)`,
    [ids],
  );
  return rows;
}

async function writeEmbeddings(db, results) {
  if (!results.length) return;
  const ts = new Date().toISOString();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const { id, model, vector } of results) {
      // pgvector binary literal — the simplest portable serialization is
      // the textual form `[v1,v2,…]`. Postgres parses it into vector(N).
      const literal = '[' + vector.map((v) => Number(v).toFixed(6)).join(',') + ']';
      await client.query(
        `UPDATE articles
           SET embedding = $1::vector,
               embedding_model = $2,
               embedded_at = $3
         WHERE id = $4`,
        [literal, model, ts, id],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function handleEmbedArticle(job) {
  const ids = Array.isArray(job.data.articleIds)
    ? job.data.articleIds.slice(0, BATCH_LIMIT)
    : [job.data.articleId].filter(Boolean);
  if (!ids.length) return { skipped: true, reason: 'NO_IDS' };

  const db = await ensureDatabase();
  const rows = await loadArticleRows(db, ids);
  if (!rows.length) return { skipped: true, reason: 'NOT_FOUND' };

  // Skip rows that already carry an embedding for the current model.
  // We do this here (not in the SELECT) so backfills can force-overwrite
  // by passing `force: true`.
  const targets = job.data.force
    ? rows
    : rows.filter((r) => !r.embedding_model);

  if (!targets.length) return { skipped: true, reason: 'ALREADY_EMBEDDED' };

  const inputs = targets.map(buildText);
  const result = await aiEmbed({ inputs, normalize: true });
  const vectors = result?.vectors || [];
  if (vectors.length !== targets.length) {
    throw new Error(`embed length mismatch: got ${vectors.length}, expected ${targets.length}`);
  }
  const model = result?.model || 'unknown';

  await writeEmbeddings(db, targets.map((row, i) => ({
    id: row.id,
    model,
    vector: vectors[i],
  })));

  return { embedded: targets.length, model };
}
