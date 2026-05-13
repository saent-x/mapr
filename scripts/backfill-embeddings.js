#!/usr/bin/env node
import pg from 'pg';
import { embed } from '../server/ai/client.js';

const { Pool } = pg;
const BATCH_SIZE = Number(process.env.MAPR_EMBED_BACKFILL_BATCH_SIZE || 16);
const LIMIT = Number(process.env.MAPR_EMBED_BACKFILL_LIMIT || 0);
const TEXT_CHARS = Number(process.env.MAPR_EMBED_BACKFILL_TEXT_CHARS || 1024);

function articleText(row) {
  let payload = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch {}
  return [row.title, payload.summary, payload.description, payload.content, payload.source, payload.isoA2]
    .filter(Boolean).join('\n').slice(0, 6000);
}

function vectorLiteral(v) {
  if (!Array.isArray(v)) throw new Error('embedding vector is not an array');
  return `[${v.map((n) => Number(n).toFixed(8)).join(',')}]`;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[&?]channel_binding=[^&]*/g, ''),
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
  });
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query('ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedding vector(1024)');
    let processed = 0;
    for (;;) {
      if (LIMIT > 0 && processed >= LIMIT) break;
      const batchLimit = LIMIT > 0 ? Math.max(0, Math.min(BATCH_SIZE, LIMIT - processed)) : BATCH_SIZE;
      const { rows } = await pool.query(`
        SELECT ctid::text AS ctid, id, title, payload
        FROM articles
        WHERE embedding IS NULL
        ORDER BY "publishedAt" DESC NULLS LAST, id
        LIMIT ${batchLimit}
      `);
      if (rows.length === 0) break;
      const result = await embed({ inputs: rows.map(articleText), normalize: true });
      const vectors = result.vectors || result.data || [];
      if (vectors.length !== rows.length) throw new Error(`embedding count mismatch: got ${vectors.length}, expected ${rows.length}`);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < rows.length; i += 1) {
          await client.query('UPDATE articles SET embedding = $2::vector WHERE ctid = $1::tid', [rows[i].ctid, vectorLiteral(vectors[i])]);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      processed += rows.length;
      console.log(`[backfill] embedded ${processed} articles`);
    }
    const count = await pool.query('SELECT count(*)::int AS embedded FROM articles WHERE embedding IS NOT NULL');
    console.log(`[backfill] complete embedded=${count.rows[0].embedded}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[backfill] failed:', err);
  process.exit(1);
});
