import path from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

let openDatabase;
let prepareStatement;

if (typeof Bun !== 'undefined') {
  const { Database } = await import('bun:sqlite');
  openDatabase = (filePath) => new Database(filePath);
  prepareStatement = (db, sql) => db.query(sql);
} else {
  const { DatabaseSync } = await import('node:sqlite');
  openDatabase = (filePath) => new DatabaseSync(filePath);
  prepareStatement = (db, sql) => db.prepare(sql);
}

const DATA_DIR = path.resolve(process.env.MAPR_DATA_DIR || path.join(process.cwd(), 'data'));
export const DATABASE_PATH = path.join(DATA_DIR, 'mapr.db');
export const SNAPSHOT_PATH = DATABASE_PATH;
export const LEGACY_SNAPSHOT_PATH = path.join(DATA_DIR, 'mapr-snapshot.json');
export const LEGACY_HISTORY_PATH = path.join(DATA_DIR, 'mapr-refresh-history.json');
export const LEGACY_COVERAGE_HISTORY_PATH = path.join(DATA_DIR, 'mapr-coverage-history.json');

let database = null;

function ensureDatabase() {
  if (database) {
    return database;
  }

  mkdirSync(DATA_DIR, { recursive: true });
  database = openDatabase(DATABASE_PATH);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refresh_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS coverage_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT UNIQUE,
      source TEXT,
      publishedAt TEXT,
      isoA2 TEXT,
      severity REAL,
      geocodePrecision TEXT,
      payload TEXT NOT NULL,
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      primaryCountry TEXT NOT NULL,
      countries TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'emerging',
      severity REAL NOT NULL DEFAULT 0,
      category TEXT,
      firstSeenAt TEXT NOT NULL,
      lastUpdatedAt TEXT NOT NULL,
      topicFingerprint TEXT,
      coordinates TEXT,
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS event_articles (
      eventId TEXT NOT NULL,
      articleId TEXT NOT NULL,
      PRIMARY KEY (eventId, articleId),
      FOREIGN KEY (eventId) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (articleId) REFERENCES articles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS source_credibility (
      sourceKey TEXT PRIMARY KEY,
      totalEvents INTEGER DEFAULT 0,
      corroboratedEvents INTEGER DEFAULT 0,
      lastUpdatedAt TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_events_lifecycle ON events(lifecycle);
    CREATE INDEX IF NOT EXISTS idx_events_lastUpdated ON events(lastUpdatedAt);
    CREATE INDEX IF NOT EXISTS idx_articles_isoA2 ON articles(isoA2);
    CREATE INDEX IF NOT EXISTS idx_articles_publishedAt ON articles(publishedAt);
  `);

  // Migration: add enrichment column to events table
  try {
    database.exec(`ALTER TABLE events ADD COLUMN enrichment TEXT DEFAULT '{}'`);
  } catch {
    // Column already exists — this is expected on existing DBs
  }

  migrateLegacyJsonIfNeeded(database);
  return database;
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function upsertMetadata(db, key, value) {
  prepareStatement(db, `
    INSERT INTO metadata (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function readLegacyJson(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function runInTransaction(db, callback) {
  db.exec('BEGIN');
  try {
    callback();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function migrateLegacyJsonIfNeeded(db) {
  const snapshotRow = prepareStatement(db, 'SELECT value FROM metadata WHERE key = ?').get('snapshot');
  const historyCount = prepareStatement(db, 'SELECT COUNT(*) AS count FROM refresh_history').get().count || 0;
  const coverageCount = prepareStatement(db, 'SELECT COUNT(*) AS count FROM coverage_history').get().count || 0;

  if (snapshotRow || historyCount > 0 || coverageCount > 0) {
    return;
  }

  const legacySnapshot = readLegacyJson(LEGACY_SNAPSHOT_PATH, null);
  const legacyHistory = readLegacyJson(LEGACY_HISTORY_PATH, []);
  const legacyCoverageHistory = readLegacyJson(LEGACY_COVERAGE_HISTORY_PATH, []);

  if (legacySnapshot) {
    prepareStatement(db, `
      INSERT INTO metadata (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('snapshot', JSON.stringify(legacySnapshot));
  }

  if (Array.isArray(legacyHistory) && legacyHistory.length > 0) {
    const insertHistory = prepareStatement(db, 'INSERT INTO refresh_history (at, payload) VALUES (?, ?)');
    runInTransaction(db, () => {
      legacyHistory
        .slice()
        .reverse()
        .forEach((entry) => {
          insertHistory.run(entry?.at || new Date().toISOString(), JSON.stringify(entry));
        });
    });
  }

  if (Array.isArray(legacyCoverageHistory) && legacyCoverageHistory.length > 0) {
    const insertCoverage = prepareStatement(db, 'INSERT INTO coverage_history (at, payload) VALUES (?, ?)');
    runInTransaction(db, () => {
      legacyCoverageHistory
        .slice()
        .reverse()
        .forEach((entry) => {
          insertCoverage.run(entry?.at || new Date().toISOString(), JSON.stringify(entry));
        });
    });
  }
}

function trimHistoryTable(db, tableName, limit) {
  prepareStatement(db, `
    DELETE FROM ${tableName}
    WHERE id NOT IN (
      SELECT id
      FROM ${tableName}
      ORDER BY id DESC
      LIMIT ?
    )
  `).run(limit);
}

export async function readSnapshot() {
  const db = ensureDatabase();
  const row = prepareStatement(db, 'SELECT value FROM metadata WHERE key = ?').get('snapshot');
  return parseJson(row?.value, null);
}

export async function writeSnapshot(snapshot) {
  const db = ensureDatabase();
  upsertMetadata(db, 'snapshot', JSON.stringify(snapshot));
  return DATABASE_PATH;
}

export async function readMetadataJson(key, fallback = null) {
  const db = ensureDatabase();
  const row = prepareStatement(db, 'SELECT value FROM metadata WHERE key = ?').get(key);
  return parseJson(row?.value, fallback);
}

export async function writeMetadataJson(key, payload) {
  const db = ensureDatabase();
  upsertMetadata(db, key, JSON.stringify(payload));
  return DATABASE_PATH;
}

export async function readHistory() {
  const db = ensureDatabase();
  const rows = prepareStatement(db, 'SELECT payload FROM refresh_history ORDER BY id DESC').all();
  return rows.map((row) => parseJson(row.payload, null)).filter(Boolean);
}

export async function appendHistory(entry, limit = 72) {
  const db = ensureDatabase();
  prepareStatement(db, 'INSERT INTO refresh_history (at, payload) VALUES (?, ?)').run(
    entry?.at || new Date().toISOString(),
    JSON.stringify(entry)
  );
  trimHistoryTable(db, 'refresh_history', limit);
  return readHistory();
}

export async function readCoverageHistory() {
  const db = ensureDatabase();
  const rows = prepareStatement(db, 'SELECT payload FROM coverage_history ORDER BY id DESC').all();
  return rows.map((row) => parseJson(row.payload, null)).filter(Boolean);
}

export async function writeCoverageHistory(history) {
  const db = ensureDatabase();
  runInTransaction(db, () => {
    db.exec('DELETE FROM coverage_history');
    const insertCoverage = prepareStatement(db, 'INSERT INTO coverage_history (at, payload) VALUES (?, ?)');
    (Array.isArray(history) ? history : [])
      .slice()
      .reverse()
      .forEach((entry) => {
        insertCoverage.run(entry?.at || new Date().toISOString(), JSON.stringify(entry));
      });
  });
  return DATABASE_PATH;
}

export async function upsertArticles(articles) {
  const db = ensureDatabase();
  const stmt = prepareStatement(db, `
    INSERT INTO articles (id, title, url, source, publishedAt, isoA2, severity, geocodePrecision, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      id = excluded.id,
      title = excluded.title,
      source = excluded.source,
      publishedAt = excluded.publishedAt,
      isoA2 = excluded.isoA2,
      severity = excluded.severity,
      geocodePrecision = excluded.geocodePrecision,
      payload = excluded.payload
  `);
  runInTransaction(db, () => {
    for (const article of articles) {
      stmt.run(
        article.id,
        article.title,
        article.url ?? null,
        article.source ?? null,
        article.publishedAt ?? null,
        article.isoA2 ?? null,
        article.severity ?? null,
        article.geocodePrecision ?? null,
        JSON.stringify(article)
      );
    }
  });
}

export async function readArticles({ since, isoA2 } = {}) {
  const db = ensureDatabase();
  const conditions = [];
  const params = [];

  if (since) {
    conditions.push('publishedAt >= ?');
    params.push(since);
  }
  if (isoA2) {
    conditions.push('isoA2 = ?');
    params.push(isoA2);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = prepareStatement(db, `SELECT payload FROM articles ${where} ORDER BY publishedAt DESC`).all(...params);
  return rows.map((row) => parseJson(row.payload, null)).filter(Boolean);
}

export async function upsertEvent(event) {
  const db = ensureDatabase();
  prepareStatement(db, `
    INSERT INTO events (id, title, primaryCountry, countries, lifecycle, severity, category, firstSeenAt, lastUpdatedAt, topicFingerprint, coordinates, enrichment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      primaryCountry = excluded.primaryCountry,
      countries = excluded.countries,
      lifecycle = excluded.lifecycle,
      severity = excluded.severity,
      category = excluded.category,
      firstSeenAt = excluded.firstSeenAt,
      lastUpdatedAt = excluded.lastUpdatedAt,
      topicFingerprint = excluded.topicFingerprint,
      coordinates = excluded.coordinates,
      enrichment = excluded.enrichment
  `).run(
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
  );
}

export async function readActiveEvents({ maxAgeHours } = {}) {
  const db = ensureDatabase();
  const conditions = ["lifecycle != 'resolved'"];
  const params = [];

  if (maxAgeHours != null) {
    conditions.push(`lastUpdatedAt >= datetime('now', '-${Number(maxAgeHours)} hours')`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const rows = prepareStatement(db, `SELECT * FROM events ${where} ORDER BY lastUpdatedAt DESC`).all(...params);
  return rows.map((row) => {
    const enrichment = JSON.parse(row.enrichment || '{}');
    return {
      ...row,
      ...enrichment,
      countries: parseJson(row.countries, []),
      topicFingerprint: parseJson(row.topicFingerprint, []),
      coordinates: parseJson(row.coordinates, null),
    };
  });
}

export async function updateEventLifecycle(eventId, lifecycle) {
  const db = ensureDatabase();
  prepareStatement(db, `UPDATE events SET lifecycle = ?, lastUpdatedAt = datetime('now') WHERE id = ?`).run(lifecycle, eventId);
}

export async function linkArticlesToEvent(eventId, articleIds) {
  const db = ensureDatabase();
  const stmt = prepareStatement(db, `INSERT OR IGNORE INTO event_articles (eventId, articleId) VALUES (?, ?)`);
  runInTransaction(db, () => {
    for (const articleId of articleIds) {
      stmt.run(eventId, articleId);
    }
  });
}

export async function readEventArticles(eventId) {
  const db = ensureDatabase();
  const rows = prepareStatement(db, `
    SELECT a.payload FROM articles a
    INNER JOIN event_articles ea ON ea.articleId = a.id
    WHERE ea.eventId = ?
    ORDER BY a.publishedAt DESC
  `).all(eventId);
  return rows.map((row) => parseJson(row.payload, null)).filter(Boolean);
}

export async function pruneResolvedEvents(maxAgeDays = 30) {
  const db = ensureDatabase();
  prepareStatement(db, `
    DELETE FROM events
    WHERE lifecycle = 'resolved'
      AND lastUpdatedAt < datetime('now', '-' || ? || ' days')
  `).run(maxAgeDays);
}

export async function pruneOrphanedArticles(maxAgeDays = 30) {
  const db = ensureDatabase();
  prepareStatement(db, `
    DELETE FROM articles
    WHERE id NOT IN (SELECT articleId FROM event_articles)
      AND createdAt < datetime('now', '-' || ? || ' days')
  `).run(maxAgeDays);
}

export async function updateSourceCredibility(sourceKey, wasCorroborated) {
  const db = ensureDatabase();
  prepareStatement(db,
    `INSERT INTO source_credibility (sourceKey, totalEvents, corroboratedEvents, lastUpdatedAt)
     VALUES (?, 1, ?, datetime('now'))
     ON CONFLICT(sourceKey) DO UPDATE SET
       totalEvents = totalEvents + 1,
       corroboratedEvents = corroboratedEvents + ?,
       lastUpdatedAt = datetime('now')`
  ).run(sourceKey, wasCorroborated ? 1 : 0, wasCorroborated ? 1 : 0);
}

export async function readSourceCredibility(sourceKey) {
  const db = ensureDatabase();
  return prepareStatement(db, 'SELECT * FROM source_credibility WHERE sourceKey = ?').get(sourceKey) || null;
}

export function closeStorage() {
  if (database) {
    database.close();
    database = null;
  }
}
