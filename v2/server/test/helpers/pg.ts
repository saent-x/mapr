// Starts a throwaway ParadeDB container (or uses TEST_DATABASE_URL) and loads the migrations.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../../db/migrations');
const IMAGE = process.env.TEST_PARADEDB_IMAGE ?? 'paradedb/paradedb:latest';

export function dockerAvailable(): boolean {
  if (process.env.TEST_DATABASE_URL) return true;
  try {
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'pipe', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export interface TestDb {
  url: string;
  stop(): Promise<void>;
}

async function waitReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
    try {
      await c.connect();
      await c.query('SELECT 1');
      await c.end();
      return;
    } catch (err) {
      last = err;
      await c.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`database not ready: ${String(last)}`);
}

export async function startDb(): Promise<TestDb> {
  if (process.env.TEST_DATABASE_URL) {
    const url = process.env.TEST_DATABASE_URL;
    await loadSchema(url);
    return { url, stop: async () => {} };
  }
  const name = `mapr-test-${process.pid}-${Date.now()}`;
  execFileSync('docker', [
    'run', '-d', '--rm', '--name', name,
    '-e', 'POSTGRES_USER=mapr', '-e', 'POSTGRES_PASSWORD=test', '-e', 'POSTGRES_DB=mapr',
    '-p', '127.0.0.1::5432', IMAGE,
  ], { stdio: 'pipe' });
  const stop = async () => {
    try {
      execFileSync('docker', ['rm', '-f', name], { stdio: 'pipe' });
    } catch {
      /* already gone */
    }
  };
  try {
    const port = execFileSync('docker', ['port', name, '5432/tcp'], { encoding: 'utf8' }).trim().split('\n')[0]!.split(':').pop();
    const url = `postgres://mapr:test@127.0.0.1:${port}/mapr`;
    await waitReady(url, 90_000);
    // The entrypoint restarts the server once after init; wait for the final one.
    await new Promise((r) => setTimeout(r, 1500));
    await waitReady(url, 60_000);
    await loadSchema(url);
    return { url, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}

async function loadSchema(url: string): Promise<void> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const has = await c.query(`SELECT to_regclass('public.events') AS t`);
    if (!has.rows[0].t) await c.query(readFileSync(path.join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8'));
  } finally {
    await c.end();
  }
}
