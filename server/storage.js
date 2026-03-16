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
  `);

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
  prepareStatement(db, `
    INSERT INTO metadata (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('snapshot', JSON.stringify(snapshot));
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

export function closeStorage() {
  if (database) {
    database.close();
    database = null;
  }
}
