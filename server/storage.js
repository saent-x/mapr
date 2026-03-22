import pg from 'pg';

const { Pool } = pg;

let pool = null;

function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('neon.tech') ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000
  });

  return pool;
}

async function ensureSchema() {
  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refresh_history (
      id SERIAL PRIMARY KEY,
      at TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS coverage_history (
      id SERIAL PRIMARY KEY,
      at TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT UNIQUE,
      source TEXT,
      "publishedAt" TEXT,
      "isoA2" TEXT,
      severity REAL,
      "geocodePrecision" TEXT,
      payload TEXT NOT NULL,
      "createdAt" TEXT DEFAULT (now()::text)
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      "primaryCountry" TEXT NOT NULL,
      countries TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'emerging',
      severity REAL NOT NULL DEFAULT 0,
      category TEXT,
      "firstSeenAt" TEXT NOT NULL,
      "lastUpdatedAt" TEXT NOT NULL,
      "topicFingerprint" TEXT,
      coordinates TEXT,
      enrichment TEXT DEFAULT '{}',
      "createdAt" TEXT DEFAULT (now()::text)
    );

    CREATE TABLE IF NOT EXISTS event_articles (
      "eventId" TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      "articleId" TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      PRIMARY KEY ("eventId", "articleId")
    );

    CREATE TABLE IF NOT EXISTS source_credibility (
      "sourceKey" TEXT PRIMARY KEY,
      "totalEvents" INTEGER DEFAULT 0,
      "corroboratedEvents" INTEGER DEFAULT 0,
      "lastUpdatedAt" TEXT
    );

    CREATE TABLE IF NOT EXISTS velocity_history (
      iso TEXT NOT NULL,
      "bucketAt" TEXT NOT NULL,
      "articleCount" INTEGER DEFAULT 0,
      PRIMARY KEY (iso, "bucketAt")
    );
  `);

  // Create indexes (IF NOT EXISTS is supported in Postgres)
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_events_lifecycle ON events(lifecycle);
    CREATE INDEX IF NOT EXISTS idx_events_lastUpdated ON events("lastUpdatedAt");
    CREATE INDEX IF NOT EXISTS idx_articles_isoA2 ON articles("isoA2");
    CREATE INDEX IF NOT EXISTS idx_articles_publishedAt ON articles("publishedAt");
  `);
}

let schemaReady = null;

async function ensureDatabase() {
  if (!schemaReady) {
    schemaReady = ensureSchema();
  }
  await schemaReady;
  return getPool();
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

// ── Metadata / Snapshot ──────────────────────────────────────

export async function readSnapshot() {
  const db = await ensureDatabase();
  const { rows } = await db.query('SELECT value FROM metadata WHERE key = $1', ['snapshot']);
  return rows.length ? parseJson(rows[0].value, null) : null;
}

export async function writeSnapshot(snapshot) {
  const db = await ensureDatabase();
  await db.query(`
    INSERT INTO metadata (key, value) VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `, ['snapshot', JSON.stringify(snapshot)]);
}

export async function readMetadataJson(key, fallback = null) {
  const db = await ensureDatabase();
  const { rows } = await db.query('SELECT value FROM metadata WHERE key = $1', [key]);
  return rows.length ? parseJson(rows[0].value, fallback) : fallback;
}

export async function writeMetadataJson(key, payload) {
  const db = await ensureDatabase();
  await db.query(`
    INSERT INTO metadata (key, value) VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `, [key, JSON.stringify(payload)]);
}

// ── Refresh History ──────────────────────────────────────────

export async function readHistory() {
  const db = await ensureDatabase();
  const { rows } = await db.query('SELECT payload FROM refresh_history ORDER BY id DESC');
  return rows.map(r => parseJson(r.payload, null)).filter(Boolean);
}

export async function appendHistory(entry, limit = 72) {
  const db = await ensureDatabase();
  await db.query(
    'INSERT INTO refresh_history (at, payload) VALUES ($1, $2)',
    [entry?.at || new Date().toISOString(), JSON.stringify(entry)]
  );
  // Trim old entries
  await db.query(`
    DELETE FROM refresh_history WHERE id NOT IN (
      SELECT id FROM refresh_history ORDER BY id DESC LIMIT $1
    )
  `, [limit]);
  return readHistory();
}

// ── Coverage History ─────────────────────────────────────────

export async function readCoverageHistory() {
  const db = await ensureDatabase();
  const { rows } = await db.query('SELECT payload FROM coverage_history ORDER BY id DESC');
  return rows.map(r => parseJson(r.payload, null)).filter(Boolean);
}

export async function writeCoverageHistory(history) {
  const db = await ensureDatabase();
  await db.query('DELETE FROM coverage_history');
  const entries = Array.isArray(history) ? history : [];
  for (const entry of [...entries].reverse()) {
    await db.query(
      'INSERT INTO coverage_history (at, payload) VALUES ($1, $2)',
      [entry?.at || new Date().toISOString(), JSON.stringify(entry)]
    );
  }
}

// ── Articles ─────────────────────────────────────────────────

export async function upsertArticles(articles) {
  const db = await ensureDatabase();
  for (const article of articles) {
    await db.query(`
      INSERT INTO articles (id, title, url, source, "publishedAt", "isoA2", severity, "geocodePrecision", payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (url) DO UPDATE SET
        id = EXCLUDED.id,
        title = EXCLUDED.title,
        source = EXCLUDED.source,
        "publishedAt" = EXCLUDED."publishedAt",
        "isoA2" = EXCLUDED."isoA2",
        severity = EXCLUDED.severity,
        "geocodePrecision" = EXCLUDED."geocodePrecision",
        payload = EXCLUDED.payload
    `, [
      article.id,
      article.title,
      article.url ?? null,
      article.source ?? null,
      article.publishedAt ?? null,
      article.isoA2 ?? null,
      article.severity ?? null,
      article.geocodePrecision ?? null,
      JSON.stringify(article)
    ]);
  }
}

export async function readArticles({ since, isoA2 } = {}) {
  const db = await ensureDatabase();
  const conditions = [];
  const params = [];
  let idx = 1;

  if (since) { conditions.push(`"publishedAt" >= $${idx++}`); params.push(since); }
  if (isoA2) { conditions.push(`"isoA2" = $${idx++}`); params.push(isoA2); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(`SELECT payload FROM articles ${where} ORDER BY "publishedAt" DESC`, params);
  return rows.map(r => parseJson(r.payload, null)).filter(Boolean);
}

// ── Events ───────────────────────────────────────────────────

export async function upsertEvent(event) {
  const db = await ensureDatabase();
  await db.query(`
    INSERT INTO events (id, title, "primaryCountry", countries, lifecycle, severity, category, "firstSeenAt", "lastUpdatedAt", "topicFingerprint", coordinates, enrichment)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      "primaryCountry" = EXCLUDED."primaryCountry",
      countries = EXCLUDED.countries,
      lifecycle = EXCLUDED.lifecycle,
      severity = EXCLUDED.severity,
      category = EXCLUDED.category,
      "firstSeenAt" = EXCLUDED."firstSeenAt",
      "lastUpdatedAt" = EXCLUDED."lastUpdatedAt",
      "topicFingerprint" = EXCLUDED."topicFingerprint",
      coordinates = EXCLUDED.coordinates,
      enrichment = EXCLUDED.enrichment
  `, [
    event.id,
    event.title,
    event.primaryCountry,
    JSON.stringify(event.countries ?? []),
    event.lifecycle ?? 'emerging',
    event.severity ?? 0,
    event.category ?? null,
    event.firstSeenAt,
    event.lastUpdatedAt,
    event.topicFingerprint ?? null,
    event.coordinates != null ? JSON.stringify(event.coordinates) : null,
    event.enrichment ?? '{}'
  ]);
}

export async function readActiveEvents({ maxAgeHours } = {}) {
  const db = await ensureDatabase();
  const conditions = ["lifecycle != 'resolved'"];
  const params = [];
  let idx = 1;

  if (maxAgeHours != null) {
    conditions.push(`"lastUpdatedAt" >= $${idx++}`);
    params.push(new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString());
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const { rows } = await db.query(`SELECT * FROM events ${where} ORDER BY "lastUpdatedAt" DESC`, params);
  return rows.map(row => {
    const enrichment = parseJson(row.enrichment, {});
    return {
      ...row,
      ...enrichment,
      countries: parseJson(row.countries, []),
      topicFingerprint: parseJson(row.topicFingerprint, []),
      coordinates: parseJson(row.coordinates, null)
    };
  });
}

export async function updateEventLifecycle(eventId, lifecycle) {
  const db = await ensureDatabase();
  await db.query(
    `UPDATE events SET lifecycle = $1, "lastUpdatedAt" = $2 WHERE id = $3`,
    [lifecycle, new Date().toISOString(), eventId]
  );
}

export async function linkArticlesToEvent(eventId, articleIds) {
  const db = await ensureDatabase();
  for (const articleId of articleIds) {
    await db.query(`
      INSERT INTO event_articles ("eventId", "articleId") VALUES ($1, $2)
      ON CONFLICT ("eventId", "articleId") DO NOTHING
    `, [eventId, articleId]);
  }
}

export async function readEventArticles(eventId) {
  const db = await ensureDatabase();
  const { rows } = await db.query(`
    SELECT a.payload FROM articles a
    INNER JOIN event_articles ea ON ea."articleId" = a.id
    WHERE ea."eventId" = $1
    ORDER BY a."publishedAt" DESC
  `, [eventId]);
  return rows.map(r => parseJson(r.payload, null)).filter(Boolean);
}

export async function pruneResolvedEvents(maxAgeDays = 30) {
  const db = await ensureDatabase();
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  await db.query(`DELETE FROM events WHERE lifecycle = 'resolved' AND "lastUpdatedAt" < $1`, [cutoff]);
}

export async function pruneOrphanedArticles(maxAgeDays = 30) {
  const db = await ensureDatabase();
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  await db.query(`
    DELETE FROM articles
    WHERE id NOT IN (SELECT "articleId" FROM event_articles)
      AND "createdAt" < $1
  `, [cutoff]);
}

// ── Source Credibility ───────────────────────────────────────

export async function updateSourceCredibility(sourceKey, wasCorroborated) {
  const db = await ensureDatabase();
  const inc = wasCorroborated ? 1 : 0;
  await db.query(`
    INSERT INTO source_credibility ("sourceKey", "totalEvents", "corroboratedEvents", "lastUpdatedAt")
    VALUES ($1, 1, $2, now()::text)
    ON CONFLICT ("sourceKey") DO UPDATE SET
      "totalEvents" = source_credibility."totalEvents" + 1,
      "corroboratedEvents" = source_credibility."corroboratedEvents" + $2,
      "lastUpdatedAt" = now()::text
  `, [sourceKey, inc]);
}

export async function readSourceCredibility(sourceKey) {
  const db = await ensureDatabase();
  const { rows } = await db.query('SELECT * FROM source_credibility WHERE "sourceKey" = $1', [sourceKey]);
  return rows.length ? rows[0] : null;
}

// ── Velocity History ─────────────────────────────────────────

export async function upsertVelocityBucket(iso, bucketAt, articleCount) {
  const db = await ensureDatabase();
  await db.query(`
    INSERT INTO velocity_history (iso, "bucketAt", "articleCount")
    VALUES ($1, $2, $3)
    ON CONFLICT (iso, "bucketAt") DO UPDATE SET "articleCount" = EXCLUDED."articleCount"
  `, [iso, bucketAt, articleCount]);
}

export async function readVelocityHistory(iso, sinceDays = 7) {
  const db = await ensureDatabase();
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const { rows } = await db.query(
    `SELECT "bucketAt", "articleCount" FROM velocity_history WHERE iso = $1 AND "bucketAt" >= $2 ORDER BY "bucketAt" ASC`,
    [iso, since]
  );
  return rows;
}

// ── Cleanup ──────────────────────────────────────────────────

export async function closeStorage() {
  if (pool) {
    await pool.end();
    pool = null;
    schemaReady = null;
  }
}

// Legacy compatibility exports (no longer used but keep to avoid import errors)
export const DATABASE_PATH = 'neon-postgres';
export const SNAPSHOT_PATH = DATABASE_PATH;
