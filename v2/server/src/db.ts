import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import type { Logger } from './log.js';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(databaseUrl: string, max = 10): Db {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'mapr-ingestor',
  });
  // An idle client error (db restart) must not crash the process.
  pool.on('error', () => {});
  return pool;
}

export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** pgvector literal. */
export function toVector(v: ArrayLike<number>): string {
  return '[' + Array.from(v, (x) => (Number.isFinite(x) ? x : 0).toString()).join(',') + ']';
}

export function parseVector(s: string): number[] {
  return s.slice(1, -1).split(',').map(Number);
}

/**
 * Apply additive migrations (0002 and later) that docker-entrypoint-initdb.d
 * did not run because the database already existed. 0001 is the base schema
 * and is never re-applied here. Applied files are recorded in mapr_migrations;
 * files must be idempotent because initdb may already have run them once.
 */
export async function applyMigrations(db: Db, dir: string, logger?: Logger): Promise<string[]> {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.startsWith('0001_')).sort();
  } catch {
    logger?.warn('migrations dir not found; skipping', { dir });
    return [];
  }
  const applied: string[] = [];
  await withTx(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(727001)');
    await tx.query(
      'CREATE TABLE IF NOT EXISTS mapr_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set(
      (await tx.query<{ name: string }>('SELECT name FROM mapr_migrations')).rows.map((r) => r.name),
    );
    for (const f of files) {
      if (done.has(f)) continue;
      await tx.query(readFileSync(path.join(dir, f), 'utf8'));
      await tx.query('INSERT INTO mapr_migrations (name) VALUES ($1)', [f]);
      applied.push(f);
    }
  });
  if (applied.length) logger?.info('migrations applied', { applied });
  return applied;
}
