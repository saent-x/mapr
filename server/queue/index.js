/**
 * server/queue/index.js — BullMQ queue factory.
 *
 * Connects to Redis using $REDIS_URL. When the env var is unset, every
 * factory returns null and callers fall back to synchronous/no-op paths
 * — this keeps local dev (no Redis) and emergency rollbacks working.
 *
 * Queue names match the plan §C6:
 *   embed-article
 *   ner-article
 *   generate-brief
 *   daily-digest
 *   story-thread-update
 *   credibility-explain
 */

import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || '';

let _connection = null;
let _disabled = !REDIS_URL;

const queues = new Map();
const workers = [];
const events = new Map();

function getConnection() {
  if (_disabled) return null;
  if (_connection) return _connection;
  _connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  _connection.on('error', (err) => {
    console.warn('[queue] redis error', err.message);
  });
  return _connection;
}

export function isQueueEnabled() {
  return !_disabled;
}

/**
 * Idempotent. Returns the cached Queue instance, or null when Redis isn't
 * configured. Set retry + backoff defaults on the queue's default job
 * options so workers don't need to repeat them.
 */
export function getQueue(name) {
  if (_disabled) return null;
  if (queues.has(name)) return queues.get(name);
  const conn = getConnection();
  if (!conn) return null;
  const queue = new Queue(name, {
    connection: conn,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
    },
  });
  queues.set(name, queue);
  return queue;
}

/**
 * Attach a worker to a queue. Stored in the workers[] array so they can
 * be drained on shutdown.
 */
export function startWorker(name, handler, { concurrency = 4 } = {}) {
  if (_disabled) return null;
  const conn = getConnection();
  if (!conn) return null;
  const worker = new Worker(name, handler, { connection: conn, concurrency });
  worker.on('failed', (job, err) => {
    console.warn(`[queue:${name}] job ${job?.id} failed:`, err.message);
  });
  workers.push(worker);
  return worker;
}

export function getQueueEvents(name) {
  if (_disabled) return null;
  if (events.has(name)) return events.get(name);
  const conn = getConnection();
  if (!conn) return null;
  const qe = new QueueEvents(name, { connection: conn });
  events.set(name, qe);
  return qe;
}

export async function shutdownQueue() {
  await Promise.all(workers.map((w) => w.close().catch(() => {})));
  await Promise.all([...queues.values()].map((q) => q.close().catch(() => {})));
  await Promise.all([...events.values()].map((e) => e.close().catch(() => {})));
  if (_connection) { try { await _connection.quit(); } catch { /* ignore */ } }
}

export const QUEUE_NAMES = Object.freeze({
  EMBED_ARTICLE: 'embed-article',
  NER_ARTICLE: 'ner-article',
  GENERATE_BRIEF: 'generate-brief',
  DAILY_DIGEST: 'daily-digest',
  STORY_THREAD_UPDATE: 'story-thread-update',
  CREDIBILITY_EXPLAIN: 'credibility-explain',
});
