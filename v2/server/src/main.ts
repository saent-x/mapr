import path from 'node:path';
import { clusterPending } from './cluster/pipeline.js';
import { loadConfig, type Config } from './config.js';
import { applyMigrations, createPool, type Db } from './db.js';
import { HttpEmbedder, type Embedder } from './embed/client.js';
import { CLOUDFLARE_MODEL_FOR, CloudflareEmbedder, RoutedEmbedder } from './embed/cloudflare.js';
import { createApiServer, type AppState } from './http/server.js';
import { pollAll } from './ingest/poller.js';
import { BudgetGate, recordNeurons } from './jobs/budget.js';
import { JobRunner } from './jobs/runner.js';
import { log, setLogLevel, type Logger } from './log.js';
import { setBlockedHosts } from './net/ssrf.js';
import { sleep } from './util/pool.js';

const SHUTDOWN_GRACE_MS = 25_000;

/** Run `fn` now and then every `intervalMs` (measured start to start, never overlapping). */
async function every(name: string, intervalMs: number, signal: AbortSignal, fn: () => Promise<void>): Promise<void> {
  while (!signal.aborted) {
    const t0 = Date.now();
    try {
      await fn();
    } catch (err) {
      log.error(`${name} failed`, { err });
    }
    await sleep(Math.max(1_000, intervalMs - (Date.now() - t0)), signal);
  }
}

/**
 * Local embedder, or Workers AI with the same model on the local embedder as the
 * backup when the daily neuron budget is closed (so vectors never mix models).
 */
function makeEmbedder(cfg: Config, db: Db, logger: Logger): Embedder {
  const local = new HttpEmbedder({ url: cfg.embedderUrl, batchSize: cfg.embedBatch });
  if (cfg.embedProvider === 'local') return local;
  const model = CLOUDFLARE_MODEL_FOR[cfg.embedModelId];
  if (!model) throw new Error(`config: Workers AI does not host ${cfg.embedModelId}; use EMBED_PROVIDER=local`);
  if (!cfg.cfAccountId || !cfg.cfApiToken) throw new Error('config: EMBED_PROVIDER=cloudflare needs CF_ACCOUNT_ID and CF_API_TOKEN_FILE');
  const gate = new BudgetGate(db, cfg.dailyNeuronCeiling);
  let lastNote = 0;
  return new RoutedEmbedder({
    cloudflare: new CloudflareEmbedder({
      accountId: cfg.cfAccountId,
      apiToken: cfg.cfApiToken,
      model,
      onNeurons: (n) => recordNeurons(db, n),
    }),
    local,
    budgetOpen: async () => (await gate.check()).open,
    onFallback: (reason, err) => {
      if (Date.now() - lastNote < 10 * 60_000) return;
      lastNote = Date.now();
      logger.warn('embedding on the local model', { reason, err });
    },
  });
}

async function main() {
  const cfg = loadConfig();
  setLogLevel(cfg.logLevel);
  if (process.env.BLOCKED_HOSTS !== undefined) setBlockedHosts(process.env.BLOCKED_HOSTS.split(','));

  const db = createPool(cfg.databaseUrl, 12);
  await db.query('SELECT 1');
  await applyMigrations(db, process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), '../db/migrations'), log);

  const ac = new AbortController();
  const { signal } = ac;
  const state: AppState = { startedAt: new Date(), lastPoll: null, pollRunning: false };
  const embedder = makeEmbedder(cfg, db, log.child({ task: 'embed' }));
  const clusterCfg = {
    threshold: cfg.clusterThreshold,
    windowHours: cfg.clusterWindowHours,
    lookbackDays: cfg.eventLookbackDays,
    nearDupThreshold: cfg.nearDupThreshold,
    triageMaxAgeHours: cfg.triageMaxAgeHours,
    embedBatch: cfg.embedBatch,
  };
  // One clustering pass at a time in this process (the DB locks make it safe anyway; this avoids double embedding).
  let clustering: Promise<unknown> | null = null;
  const cluster = async () => {
    clustering ??= clusterPending({ db, embedder, cfg: clusterCfg, log: log.child({ task: 'cluster' }), signal }).finally(() => {
      clustering = null;
    });
    await clustering;
  };

  const runner = new JobRunner(db, {
    budget: new BudgetGate(db, cfg.dailyNeuronCeiling),
    log: log.child({ task: 'jobs' }),
    pollMs: cfg.jobPollMs,
  });
  // TODO(triage): register the Clef-flash triager once it exists:
  //   for (const h of triageHandlers(db, new ClefFlashTriager(...))) runner.register(h);
  // Until then triage / re-triage jobs are enqueued and held, not run or dropped.

  const server = createApiServer({ db, state, apiToken: cfg.apiToken, failSkipThreshold: cfg.failSkipThreshold, log: log.child({ task: 'http' }) });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.httpPort, cfg.httpHost, () => resolve());
  });
  if (!cfg.apiToken) log.warn('API_TOKEN not set: /v1/* answers 503');
  log.info('ingestor started', { http: `${cfg.httpHost}:${cfg.httpPort}`, poll_interval_min: cfg.pollIntervalMin, handlers: runner.kinds });

  const loops = [
    every('poll', cfg.pollIntervalMin * 60_000, signal, async () => {
      state.pollRunning = true;
      try {
        state.lastPoll = await pollAll({
          db,
          signal,
          log: log.child({ task: 'poll' }),
          cfg: {
            concurrency: cfg.pollConcurrency,
            timeoutMs: cfg.fetchTimeoutMs,
            maxBodyBytes: cfg.maxBodyBytes,
            maxRedirects: cfg.maxRedirects,
            userAgent: cfg.userAgent,
            failSkipThreshold: cfg.failSkipThreshold,
            reprobeHours: cfg.reprobeHours,
          },
        });
      } finally {
        state.pollRunning = false;
      }
      await cluster();
    }),
    // Picks up articles left pending when the embedder was unavailable.
    every('cluster', 5 * 60_000, signal, async () => {
      if (!state.pollRunning) await cluster();
    }),
    every('retention', cfg.retentionIntervalMin * 60_000, signal, async () => {
      const t0 = Date.now();
      await db.query('SELECT mapr_retention()');
      log.info('retention done', { ms: Date.now() - t0 });
    }),
    runner.run(signal),
  ];

  let stopping = false;
  const shutdown = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    log.info('shutting down', { signal: sig });
    ac.abort();
    server.close();
    server.closeIdleConnections();
    const timer = setTimeout(() => {
      log.warn('shutdown grace period over; exiting');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    await Promise.allSettled(loops);
    await db.end().catch(() => {});
    clearTimeout(timer);
    log.info('stopped');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => log.error('unhandled rejection', { err }));
}

main().catch((err) => {
  log.error('fatal', { err });
  process.exit(1);
});
