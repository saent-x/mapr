/**
 * Stripe webhook idempotency — two-phase claim.
 *
 * Stripe retries failed webhook deliveries for up to 3 days. Without
 * deduplication, repeat events double-fire side effects. We use a
 * two-phase commit so that if the handler crashes between claim and
 * completion, the next retry can resume processing instead of being
 * silently deduped.
 *
 * Workflow:
 *   1. `claimStripeEvent(eventId, type)` returns `{ shouldProcess, isFirst }`.
 *      - First time seen → row inserted, shouldProcess=true, isFirst=true.
 *      - Retry of an in-flight event (processed_at IS NULL) → shouldProcess=true.
 *      - Retry of a completed event (processed_at IS NOT NULL) → shouldProcess=false.
 *   2. After successful dispatch, call `markStripeEventProcessed(eventId)`
 *      so subsequent retries are deduped.
 */

import pg from 'pg';

let _pool = null;
let _ready = null;

function getPool() {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not configured');
  }
  const cleanUrl = connectionString.replace(/[&?]channel_binding=[^&]*/g, '');
  const isLocal = /localhost|127\.0\.0\.1/.test(cleanUrl);
  _pool = new pg.Pool({
    connectionString: cleanUrl,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
  return _pool;
}

async function ensureTable() {
  if (_ready) return _ready;
  _ready = (async () => {
    const db = getPool();
    await db.query(`
      CREATE TABLE IF NOT EXISTS stripe_events (
        event_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        processed_at TIMESTAMPTZ NULL
      );
    `);
    await db.query(`ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ NULL;`);
  })().catch((err) => {
    _ready = null;
    throw err;
  });
  return _ready;
}

/**
 * Try to claim a Stripe event for processing.
 * Returns `{ shouldProcess, isFirst }`.
 *   - shouldProcess=true means dispatch should run.
 *   - isFirst=true on the very first delivery; false on a recovery retry.
 * If the event was already fully processed, shouldProcess=false.
 */
export async function claimStripeEvent(eventId, eventType) {
  if (!eventId) return { shouldProcess: true, isFirst: true };
  await ensureTable();
  const db = getPool();
  // Atomic insert-or-fetch.
  const inserted = await db.query(
    `INSERT INTO stripe_events (event_id, type) VALUES ($1, $2)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [eventId, eventType || 'unknown'],
  );
  if (inserted.rowCount > 0) return { shouldProcess: true, isFirst: true };

  const existing = await db.query(
    `SELECT processed_at FROM stripe_events WHERE event_id = $1`,
    [eventId],
  );
  const processedAt = existing.rows[0]?.processed_at || null;
  return { shouldProcess: processedAt === null, isFirst: false };
}

/**
 * Mark an event as fully processed so future retries are deduped.
 */
export async function markStripeEventProcessed(eventId) {
  if (!eventId) return;
  await ensureTable();
  const db = getPool();
  await db.query(
    `UPDATE stripe_events SET processed_at = now() WHERE event_id = $1 AND processed_at IS NULL`,
    [eventId],
  );
}

/**
 * Best-effort cleanup of events older than 30 days. Stripe only retries
 * for 3 days; we keep a wider window for forensics and to limit table size.
 */
export async function pruneStripeEvents(maxAgeDays = 30) {
  await ensureTable();
  const db = getPool();
  const days = Math.max(1, Number(maxAgeDays) || 30);
  await db.query(
    `DELETE FROM stripe_events WHERE seen_at < now() - $1::int * INTERVAL '1 day'`,
    [days],
  );
}
