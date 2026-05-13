/**
 * Stripe webhook idempotency.
 *
 * Stripe retries failed webhook deliveries for up to 3 days. Without
 * deduplication, repeat events double-fire any side-effect (status
 * change, audit log, email). We persist `event.id` in `stripe_events`
 * with a creation timestamp; any repeat is short-circuited.
 *
 * The table is created lazily on first call.
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
        seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  })().catch((err) => {
    _ready = null;
    throw err;
  });
  return _ready;
}

/**
 * Try to claim a Stripe event for processing.
 * Returns true if we are the first to see it; false if already processed.
 */
export async function claimStripeEvent(eventId, eventType) {
  if (!eventId) return true; // Cannot dedupe without an id; let it proceed.
  await ensureTable();
  const db = getPool();
  const { rowCount } = await db.query(
    `INSERT INTO stripe_events (event_id, type) VALUES ($1, $2)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, eventType || 'unknown'],
  );
  return rowCount > 0;
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
