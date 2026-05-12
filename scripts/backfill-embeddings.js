#!/usr/bin/env node
/**
 * Backfill embeddings for every article in the DB.
 *
 * Pulls article ids in batches of 64, enqueues `embed-article` jobs onto
 * BullMQ, throttles to one batch every 2 seconds so live ingest isn't
 * starved. Idempotent — the worker skips rows that already have an
 * embedding_model stamped.
 *
 * Required env: DATABASE_URL, REDIS_URL, plus whatever the AI client
 * needs (MAPR_AI_HOMEPC_* or MAPR_AI_WORKERSAI_*).
 *
 * Usage:
 *   node scripts/backfill-embeddings.js [--force] [--batch-size=64]
 */

import { ensureDatabase } from '../server/storage.js';
import { getQueue, QUEUE_NAMES, isQueueEnabled, shutdownQueue } from '../server/queue/index.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const batchArg = args.find((a) => a.startsWith('--batch-size='));
const BATCH_SIZE = batchArg ? Math.max(8, Math.min(128, Number(batchArg.split('=')[1]) || 64)) : 64;
const THROTTLE_MS = 2000;

async function main() {
  if (!isQueueEnabled()) {
    console.error('REDIS_URL is not set — backfill needs a queue to run through.');
    process.exit(2);
  }

  const db = await ensureDatabase();
  const where = force ? 'TRUE' : 'embedding_model IS NULL';
  const { rows: countRows } = await db.query(`SELECT COUNT(*)::int AS n FROM articles WHERE ${where}`);
  const total = countRows[0]?.n || 0;
  if (!total) {
    console.log('Nothing to backfill.');
    await shutdownQueue();
    return;
  }
  console.log(`Backfilling embeddings for ${total} articles (batch=${BATCH_SIZE}, force=${force})`);

  const queue = getQueue(QUEUE_NAMES.EMBED_ARTICLE);
  let offset = 0;
  let enqueued = 0;

  while (offset < total) {
    const { rows } = await db.query(
      `SELECT id FROM articles
        WHERE ${where}
        ORDER BY "publishedAt" DESC NULLS LAST
        LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset],
    );
    if (!rows.length) break;
    const ids = rows.map((r) => r.id);
    await queue.add(QUEUE_NAMES.EMBED_ARTICLE, { articleIds: ids, force });
    enqueued += ids.length;
    offset += rows.length;
    console.log(`  enqueued ${enqueued}/${total}`);
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }

  console.log(`Enqueued ${enqueued} articles. Workers will process them in the background.`);
  await shutdownQueue();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  shutdownQueue().finally(() => process.exit(1));
});
