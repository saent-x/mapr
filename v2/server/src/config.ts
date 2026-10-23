import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface Config {
  databaseUrl: string;
  pollIntervalMin: number;
  pollConcurrency: number;
  fetchTimeoutMs: number;
  maxBodyBytes: number;
  maxRedirects: number;
  userAgent: string;
  failSkipThreshold: number;
  reprobeHours: number;
  embedderUrl: string;
  embedBatch: number;
  clusterThreshold: number;
  clusterWindowHours: number;
  eventLookbackDays: number;
  nearDupThreshold: number;
  triageMaxAgeHours: number;
  dailyNeuronCeiling: number;
  jobPollMs: number;
  retentionIntervalMin: number;
  httpHost: string;
  httpPort: number;
  apiToken: string | undefined;
  sourcesFile: string;
  logLevel: string;
}

type Env = Record<string, string | undefined>;

function readSecret(file: string | undefined): string | undefined {
  if (!file) return undefined;
  try {
    const v = readFileSync(file, 'utf8').trim();
    return v.length ? v : undefined;
  } catch {
    return undefined;
  }
}

function num(env: Env, key: string, def: number, min = -Infinity, max = Infinity): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`config: ${key}=${raw} is not a number in [${min}, ${max}]`);
  }
  return n;
}

/** DATABASE_URL wins; otherwise build from PG* parts and the password file. */
export function databaseUrlFrom(env: Env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const password =
    readSecret(env.PG_PASSWORD_FILE ?? '/run/secrets/pg_password') ?? env.PGPASSWORD;
  if (!password) {
    throw new Error('config: set DATABASE_URL or provide the password in PG_PASSWORD_FILE (/run/secrets/pg_password)');
  }
  const host = env.PGHOST ?? '127.0.0.1';
  const port = env.PGPORT ?? '5433';
  const user = env.PGUSER ?? 'mapr';
  const db = env.PGDATABASE ?? 'mapr';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(db)}`;
}

export function loadConfig(env: Env = process.env): Config {
  return {
    databaseUrl: databaseUrlFrom(env),
    pollIntervalMin: num(env, 'POLL_INTERVAL_MIN', 30, 1),
    pollConcurrency: num(env, 'POLL_CONCURRENCY', 16, 1, 128),
    fetchTimeoutMs: num(env, 'FETCH_TIMEOUT_MS', 15_000, 1000),
    maxBodyBytes: num(env, 'MAX_BODY_BYTES', 5 * 1024 * 1024, 1024),
    maxRedirects: num(env, 'MAX_REDIRECTS', 3, 0, 10),
    userAgent:
      env.USER_AGENT ?? 'MAPR/2.0 feed reader (+https://mapr.stbrn.studio)',
    failSkipThreshold: num(env, 'FAIL_SKIP_THRESHOLD', 12, 1),
    reprobeHours: num(env, 'REPROBE_HOURS', 24, 1),
    embedderUrl: env.EMBEDDER_URL ?? 'http://127.0.0.1:8788',
    embedBatch: num(env, 'EMBED_BATCH', 32, 1, 256),
    clusterThreshold: num(env, 'CLUSTER_THRESHOLD', 0.82, 0, 1),
    clusterWindowHours: num(env, 'CLUSTER_WINDOW_HOURS', 48, 1),
    eventLookbackDays: num(env, 'EVENT_LOOKBACK_DAYS', 7, 1),
    nearDupThreshold: num(env, 'NEAR_DUP_THRESHOLD', 0.6, 0, 1),
    triageMaxAgeHours: num(env, 'TRIAGE_MAX_AGE_HOURS', 48, 1),
    dailyNeuronCeiling: num(env, 'DAILY_NEURON_CEILING', 9000, 0),
    jobPollMs: num(env, 'JOB_POLL_MS', 5000, 100),
    retentionIntervalMin: num(env, 'RETENTION_INTERVAL_MIN', 60, 1),
    httpHost: env.HTTP_HOST ?? '127.0.0.1',
    httpPort: num(env, 'HTTP_PORT', 8787, 0, 65535),
    apiToken: env.API_TOKEN || readSecret(env.API_TOKEN_FILE),
    sourcesFile: env.SOURCES_FILE ?? path.resolve(process.cwd(), '../sources/sources.json'),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
