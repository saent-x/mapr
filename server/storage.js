import pg from 'pg';

const { Pool } = pg;

let pool = null;

function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  // Strip channel_binding parameter which some pg versions don't support
  const cleanUrl = connectionString.replace(/[&?]channel_binding=[^&]*/g, '');

  const isLocal = /localhost|127\.0\.0\.1/.test(cleanUrl);
  pool = new Pool({
    connectionString: cleanUrl,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
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
      url TEXT,
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

  // Fix schema: drop url UNIQUE constraint/index that causes spurious conflicts
  // during ON CONFLICT (id) upserts.  The id column is the canonical dedup key.
  await db.query(`ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_url_key`).catch(() => {});
  // Also drop any unique index on url (constraint name may differ across DB versions)
  await db.query(`DROP INDEX IF EXISTS articles_url_key`).catch(() => {});
  // Find and drop any remaining unique constraint on url column by introspection
  try {
    const urlUniques = await db.query(`
      SELECT c.conname FROM pg_constraint c
      JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
      WHERE c.conrelid = 'articles'::regclass AND c.contype = 'u' AND a.attname = 'url'
    `);
    for (const { conname } of urlUniques.rows) {
      await db.query(`ALTER TABLE articles DROP CONSTRAINT IF EXISTS "${conname}"`).catch(() => {});
    }
  } catch { /* table may not exist yet on first run */ }

  // Ensure id column is the primary key (older DB instances may have url as PK)
  try {
    const pkCheck = await db.query(`
      SELECT a.attname FROM pg_constraint c
      JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
      WHERE c.conrelid = 'articles'::regclass AND c.contype = 'p'
    `);
    const pkCols = pkCheck.rows.map(r => r.attname);
    if (pkCols.length > 0 && !pkCols.includes('id')) {
      console.log('[storage] Fixing articles primary key: currently on', pkCols.join(','), '→ id');
      await db.query('ALTER TABLE articles DROP CONSTRAINT articles_pkey CASCADE');
      // Remove any duplicate ids before adding the PK
      await db.query(`DELETE FROM articles a USING articles b WHERE a.id = b.id AND a.ctid < b.ctid`);
      await db.query('ALTER TABLE articles ADD PRIMARY KEY (id)');
      // Recreate event_articles FK after CASCADE drop
      await db.query(`
        ALTER TABLE event_articles DROP CONSTRAINT IF EXISTS event_articles_articleId_fkey;
        ALTER TABLE event_articles ADD CONSTRAINT event_articles_articleId_fkey
          FOREIGN KEY ("articleId") REFERENCES articles(id) ON DELETE CASCADE
      `).catch(() => {});
    }
  } catch (pkErr) {
    console.warn('[storage] Primary key check/fix warning:', pkErr.message);
  }
}

let schemaReady = null;

async function ensureDatabase() {
  if (!schemaReady) {
    schemaReady = ensureSchema().catch(err => {
      schemaReady = null;
      throw err;
    });
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
  const pool = await ensureDatabase();
  const entries = Array.isArray(history) ? history : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM coverage_history');
    for (const entry of [...entries].reverse()) {
      await client.query(
        'INSERT INTO coverage_history (at, payload) VALUES ($1, $2)',
        [entry?.at || new Date().toISOString(), JSON.stringify(entry)]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Articles ─────────────────────────────────────────────────

export async function upsertArticles(articles) {
  const db = await ensureDatabase();
  const BATCH_SIZE = 50;
  let inserted = 0;
  let skipped = 0;

  // Deduplicate by id within the batch (last occurrence wins)
  const dedupMap = new Map();
  for (const article of articles) {
    if (!article.id) { skipped++; continue; }
    dedupMap.set(article.id, article);
  }
  const uniqueArticles = [...dedupMap.values()];

  for (let i = 0; i < uniqueArticles.length; i += BATCH_SIZE) {
    const batch = uniqueArticles.slice(i, i + BATCH_SIZE);
    const values = [];
    const params = [];
    for (let j = 0; j < batch.length; j++) {
      const a = batch[j];
      const o = j * 9;
      values.push(`($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9})`);
      params.push(
        a.id, a.title, a.url ?? null, a.source ?? null,
        a.publishedAt ?? null, a.isoA2 ?? null, a.severity ?? null,
        a.geocodePrecision ?? null, JSON.stringify(a)
      );
    }
    try {
      await db.query(`
        INSERT INTO articles (id, title, url, source, "publishedAt", "isoA2", severity, "geocodePrecision", payload)
        VALUES ${values.join(',')}
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          url = EXCLUDED.url,
          source = EXCLUDED.source,
          "publishedAt" = EXCLUDED."publishedAt",
          "isoA2" = EXCLUDED."isoA2",
          severity = EXCLUDED.severity,
          "geocodePrecision" = EXCLUDED."geocodePrecision",
          payload = EXCLUDED.payload
      `, params);
      inserted += batch.length;
    } catch (batchErr) {
      // Batch failed — fall back to one-by-one for this batch
      for (const article of batch) {
        try {
          await db.query(`
            INSERT INTO articles (id, title, url, source, "publishedAt", "isoA2", severity, "geocodePrecision", payload)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title, url = EXCLUDED.url, source = EXCLUDED.source,
              "publishedAt" = EXCLUDED."publishedAt", "isoA2" = EXCLUDED."isoA2",
              severity = EXCLUDED.severity, "geocodePrecision" = EXCLUDED."geocodePrecision",
              payload = EXCLUDED.payload
          `, [
            article.id, article.title, article.url ?? null, article.source ?? null,
            article.publishedAt ?? null, article.isoA2 ?? null, article.severity ?? null,
            article.geocodePrecision ?? null, JSON.stringify(article)
          ]);
          inserted++;
        } catch (err) {
          skipped++;
          if (err?.code !== '23505') {
            console.warn('[storage] upsertArticle failed for', article.id, ':', err.message);
          }
        }
      }
    }
  }
  console.log(`[storage] upsertArticles: ${inserted} inserted/updated, ${skipped} skipped (of ${articles.length} input)`);
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
    JSON.stringify(event.topicFingerprint ?? []),
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
  const events = rows.map(row => {
    const enrichment = parseJson(row.enrichment, {});
    return {
      ...row,
      ...enrichment,
      countries: parseJson(row.countries, []),
      topicFingerprint: parseJson(row.topicFingerprint, []),
      coordinates: parseJson(row.coordinates, null)
    };
  });

  // Populate articleIds from junction table (single query for all events)
  if (events.length > 0) {
    const eventIds = events.map(e => e.id);
    const { rows: linkRows } = await db.query(
      'SELECT "eventId", "articleId" FROM event_articles WHERE "eventId" = ANY($1)',
      [eventIds]
    );
    const articlesByEvent = {};
    for (const row of linkRows) {
      if (!articlesByEvent[row.eventId]) articlesByEvent[row.eventId] = [];
      articlesByEvent[row.eventId].push(row.articleId);
    }
    for (const event of events) {
      event.articleIds = articlesByEvent[event.id] || [];
    }
  }

  return events;
}

export async function linkArticlesToEvent(eventId, articleIds) {
  const db = await ensureDatabase();
  const validIds = (articleIds || []).filter(Boolean);
  if (validIds.length === 0) return;

  // Batch insert all links at once
  const BATCH_SIZE = 100;
  for (let i = 0; i < validIds.length; i += BATCH_SIZE) {
    const batch = validIds.slice(i, i + BATCH_SIZE);
    const values = [];
    const params = [eventId];
    for (let j = 0; j < batch.length; j++) {
      values.push(`($1, $${j + 2})`);
      params.push(batch[j]);
    }
    try {
      await db.query(`
        INSERT INTO event_articles ("eventId", "articleId") VALUES ${values.join(',')}
        ON CONFLICT ("eventId", "articleId") DO NOTHING
      `, params);
    } catch (batchErr) {
      // Batch failed (FK violation likely) — fall back to one-by-one
      for (const articleId of batch) {
        try {
          await db.query(`
            INSERT INTO event_articles ("eventId", "articleId") VALUES ($1, $2)
            ON CONFLICT ("eventId", "articleId") DO NOTHING
          `, [eventId, articleId]);
        } catch (err) {
          // FK violation — skip silently
        }
      }
    }
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
  await db.query(`
    DELETE FROM articles
    WHERE id NOT IN (SELECT "articleId" FROM event_articles)
      AND "createdAt"::timestamptz < NOW() - INTERVAL '${Number(maxAgeDays)} days'
  `);
}

// ── DB Size Management ───────────────────────────────────────
//
// Limits derive from plan capacity + percentages so they track whatever tier
// is in use. When DB exceeds soft limit, trim oldest articles in batches
// until under target. CASCADE on event_articles FK auto-cleans junctions;
// orphaned events pruned after.
//
// Primary env vars (percentage-based):
//   MAPR_DB_CAPACITY_MB    — plan capacity (default 5120 = 5 GB).
//   MAPR_DB_TRIM_PERCENT   — soft-trim trigger % (default 90). limit = cap * pct/100.
//   MAPR_DB_HARD_PERCENT   — aggressive-batch % (default 95). hard = cap * pct/100.
//                            target = cap * (trim% - 5) / 100 (trim down ~5% below soft).
//
// Explicit MB overrides (ops escape hatch — win over percentage derivation):
//   MAPR_DB_SIZE_LIMIT_MB  — soft ceiling override.
//   MAPR_DB_SIZE_TARGET_MB — target override.
//   MAPR_DB_SIZE_HARD_MB   — hard ceiling override.
//
//   MAPR_DB_TRIM_BATCH     — rows deleted per pass (default 1000).

/**
 * Resolve effective DB size limits from env. Explicit MB overrides win over
 * percentage derivation from capacity.
 */
export function getDbSizeLimits() {
  const capacityMb = Number(process.env.MAPR_DB_CAPACITY_MB) || 5120;
  const trimPct = Number(process.env.MAPR_DB_TRIM_PERCENT) || 90;
  const hardPct = Number(process.env.MAPR_DB_HARD_PERCENT) || 95;
  const targetPct = Math.max(0, trimPct - 5);
  const limitMb = Number(process.env.MAPR_DB_SIZE_LIMIT_MB) || Math.round(capacityMb * trimPct / 100);
  const hardMb = Number(process.env.MAPR_DB_SIZE_HARD_MB) || Math.round(capacityMb * hardPct / 100);
  const targetMb = Number(process.env.MAPR_DB_SIZE_TARGET_MB) || Math.round(capacityMb * targetPct / 100);
  return { capacityMb, trimPct, hardPct, limitMb, hardMb, targetMb };
}

export async function getDbSize() {
  const db = await ensureDatabase();
  try {
    const { rows } = await db.query(`SELECT pg_database_size(current_database()) AS bytes`);
    const bytes = Number(rows[0]?.bytes || 0);
    return {
      bytes,
      mb: +(bytes / (1024 * 1024)).toFixed(2)
    };
  } catch (err) {
    console.warn('[storage] getDbSize failed:', err.message);
    return { bytes: 0, mb: 0 };
  }
}

export async function getTableSizes() {
  const db = await ensureDatabase();
  try {
    const { rows } = await db.query(`
      SELECT relname AS table, pg_total_relation_size(C.oid) AS bytes
      FROM pg_class C
      LEFT JOIN pg_namespace N ON N.oid = C.relnamespace
      WHERE nspname = 'public' AND relkind = 'r'
      ORDER BY bytes DESC
    `);
    return rows.map(r => ({ table: r.table, mb: +(Number(r.bytes) / (1024 * 1024)).toFixed(2) }));
  } catch {
    return [];
  }
}

/**
 * Trim oldest articles until DB size drops below target.
 * Returns summary { startMb, endMb, deletedArticles, deletedEvents, passes }.
 */
export async function enforceDbSizeLimit({
  limitMb,
  targetMb,
  hardMb,
  batchSize = Number(process.env.MAPR_DB_TRIM_BATCH || 1000),
  maxPasses = 40
} = {}) {
  const db = await ensureDatabase();
  const defaults = getDbSizeLimits();
  if (limitMb == null) limitMb = defaults.limitMb;
  if (hardMb == null) hardMb = defaults.hardMb;
  if (targetMb == null) targetMb = defaults.targetMb;
  const target = targetMb ?? Math.max(50, limitMb - 50);
  const start = await getDbSize();

  if (start.mb < limitMb) {
    return { startMb: start.mb, endMb: start.mb, deletedArticles: 0, deletedEvents: 0, passes: 0, limitMb, targetMb: target };
  }

  // Aggressive batch when over hard ceiling
  const effectiveBatch = start.mb >= hardMb ? batchSize * 4 : batchSize;

  console.log(`[storage] DB size ${start.mb} MB exceeds limit ${limitMb} MB. Trimming to ${target} MB...`);

  let deletedArticles = 0;
  let deletedEvents = 0;
  let passes = 0;
  let lastSize = start.mb;

  for (let i = 0; i < maxPasses; i++) {
    passes++;
    // Delete oldest articles by publishedAt (fall back to createdAt). CASCADE clears event_articles.
    const { rowCount: aDel } = await db.query(`
      DELETE FROM articles
      WHERE id IN (
        SELECT id FROM articles
        ORDER BY COALESCE("publishedAt", "createdAt") ASC NULLS FIRST
        LIMIT $1
      )
    `, [effectiveBatch]);
    deletedArticles += aDel || 0;

    // Drop events that lost all their articles
    const { rowCount: eDel } = await db.query(`
      DELETE FROM events
      WHERE id NOT IN (SELECT DISTINCT "eventId" FROM event_articles)
    `);
    deletedEvents += eDel || 0;

    // VACUUM to reclaim space — without it pg_database_size won't drop
    await db.query('VACUUM articles').catch(() => {});
    await db.query('VACUUM events').catch(() => {});
    await db.query('VACUUM event_articles').catch(() => {});

    const cur = await getDbSize();
    if (cur.mb <= target || aDel === 0) {
      lastSize = cur.mb;
      break;
    }
    // Stuck: size not dropping despite deletes
    if (Math.abs(lastSize - cur.mb) < 0.1 && i > 2) {
      console.warn(`[storage] DB size not shrinking (${cur.mb} MB). Stopping trim.`);
      lastSize = cur.mb;
      break;
    }
    lastSize = cur.mb;
  }

  // Trim oversized aux tables too
  await db.query(`
    DELETE FROM refresh_history WHERE id NOT IN (
      SELECT id FROM refresh_history ORDER BY id DESC LIMIT 72
    )
  `).catch(() => {});
  await db.query(`
    DELETE FROM coverage_history WHERE id NOT IN (
      SELECT id FROM coverage_history ORDER BY id DESC LIMIT 96
    )
  `).catch(() => {});
  await db.query(`
    DELETE FROM velocity_history WHERE "bucketAt" < $1
  `, [new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()]).catch(() => {});

  console.log(`[storage] Trim done: ${start.mb} MB → ${lastSize} MB (deleted ${deletedArticles} articles, ${deletedEvents} events in ${passes} passes)`);

  return {
    startMb: start.mb,
    endMb: lastSize,
    deletedArticles,
    deletedEvents,
    passes,
    limitMb,
    targetMb: target
  };
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
