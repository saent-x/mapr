import { createHash } from 'node:crypto';
import type { Db } from '../db.js';
import { FeedParseError, parseFeed } from '../feeds/parse.js';
import type { Logger } from '../log.js';
import { decodeBody, fetchFeed, type FetchOptions } from '../net/fetcher.js';
import { forEachLimit } from '../util/pool.js';
import { storeItems } from './store.js';

export interface PollConfig {
  concurrency: number;
  timeoutMs: number;
  maxBodyBytes: number;
  maxRedirects: number;
  userAgent: string;
  failSkipThreshold: number;
  reprobeHours: number;
}

export interface PollSummary {
  startedAt: string;
  finishedAt: string;
  sources: number;
  ok: number;
  notModified: number;
  unchanged: number;
  failed: number;
  newArticles: number;
}

interface SourceRow {
  id: number;
  name: string;
  url: string;
  etag: string | null;
  last_modified: string | null;
  fail_count: number;
  body_hash: string | null;
}

export interface PollDeps {
  db: Db;
  cfg: PollConfig;
  log: Logger;
  signal?: AbortSignal;
  /** Overrides for tests (dispatcher, resolver). */
  fetchOverrides?: Partial<FetchOptions>;
}

/**
 * Sources due for a poll: enabled RSS feeds, except those auto-skipped after
 * `failSkipThreshold` consecutive failures, which are re-probed once every `reprobeHours`.
 * GDELT: TODO. The one gdelt source is seeded disabled. Its DOC API answers
 * with articles from thousands of domains under a single source id, which
 * would break source_count (distinct sources) and therefore the 3rd/6th-source
 * re-triage rule; supporting it needs per-domain pseudo-sources first.
 */
export async function dueSources(db: Db, cfg: PollConfig): Promise<SourceRow[]> {
  const r = await db.query<SourceRow>(
    `SELECT s.id, s.name, s.url, s.etag, s.last_modified, s.fail_count, p.body_hash
     FROM sources s LEFT JOIN source_polls p ON p.source_id = s.id
     WHERE s.enabled AND s.kind = 'rss'
       AND (s.fail_count < $1 OR p.last_attempt_at IS NULL OR p.last_attempt_at < now() - make_interval(hours => $2))
     ORDER BY s.id`,
    [cfg.failSkipThreshold, cfg.reprobeHours],
  );
  return r.rows;
}

async function recordAttempt(db: Db, id: number, status: number | null, bodyHash: string | null, finalUrl: string | null) {
  await db.query(
    `INSERT INTO source_polls (source_id, last_attempt_at, last_status, body_hash, final_url)
     VALUES ($1, now(), $2, $3, $4)
     ON CONFLICT (source_id) DO UPDATE SET
       last_attempt_at = now(),
       last_status = EXCLUDED.last_status,
       body_hash = COALESCE(EXCLUDED.body_hash, source_polls.body_hash),
       final_url = COALESCE(EXCLUDED.final_url, source_polls.final_url)`,
    [id, status, bodyHash, finalUrl],
  );
}

export async function pollSource(deps: PollDeps, s: SourceRow): Promise<{ outcome: 'ok' | 'not-modified' | 'unchanged' | 'failed'; inserted: number }> {
  const { db, cfg, log } = deps;
  const slog = log.child({ source_id: s.id, source: s.name });
  try {
    const res = await fetchFeed(s.url, {
      etag: s.etag,
      lastModified: s.last_modified,
      timeoutMs: cfg.timeoutMs,
      maxBytes: cfg.maxBodyBytes,
      maxRedirects: cfg.maxRedirects,
      userAgent: cfg.userAgent,
      ...(deps.signal ? { signal: deps.signal } : {}),
      ...deps.fetchOverrides,
    });
    if (res.notModified) {
      await db.query(
        `UPDATE sources SET fail_count = 0, last_error = NULL, last_ok_at = now(),
           etag = COALESCE($2, etag), last_modified = COALESCE($3, last_modified) WHERE id = $1`,
        [s.id, res.etag ?? null, res.lastModified ?? null],
      );
      await recordAttempt(db, s.id, 304, null, res.finalUrl);
      return { outcome: 'not-modified', inserted: 0 };
    }
    const body = res.body!;
    const hash = createHash('sha256').update(body).digest('hex');
    let inserted = 0;
    let outcome: 'ok' | 'unchanged' = 'unchanged';
    if (hash !== s.body_hash) {
      const feed = parseFeed(decodeBody(body, res.contentType), res.finalUrl);
      const stored = await storeItems(db, s.id, feed.items, {
        preferHttps: new URL(res.finalUrl).protocol === 'https:',
        lang: feed.lang,
      });
      inserted = stored.inserted;
      outcome = 'ok';
      if (feed.items.length === 0) slog.debug('feed has no items', { format: feed.format });
    }
    await db.query(
      `UPDATE sources SET fail_count = 0, last_error = NULL, last_ok_at = now(), etag = $2, last_modified = $3 WHERE id = $1`,
      [s.id, res.etag ?? null, res.lastModified ?? null],
    );
    await recordAttempt(db, s.id, res.status, hash, res.finalUrl);
    if (s.fail_count > 0) slog.info('source recovered', { after_failures: s.fail_count });
    return { outcome, inserted };
  } catch (err) {
    if (deps.signal?.aborted) return { outcome: 'failed', inserted: 0 };
    const e = err as Error & { status?: number };
    const msg = `${e.name === 'Error' ? '' : e.name + ': '}${e.message}`.slice(0, 500);
    const r = await db.query<{ fail_count: number }>(
      `UPDATE sources SET fail_count = fail_count + 1, last_error = $2 WHERE id = $1 RETURNING fail_count`,
      [s.id, msg],
    );
    await recordAttempt(db, s.id, e.status ?? null, null, null);
    const n = r.rows[0]?.fail_count ?? 0;
    if (n === cfg.failSkipThreshold) {
      slog.warn('source auto-skipped after consecutive failures; re-probing daily', { fail_count: n, err: msg });
    } else {
      slog[err instanceof FeedParseError ? 'warn' : 'info']('source poll failed', { fail_count: n, err: msg });
    }
    return { outcome: 'failed', inserted: 0 };
  }
}

export async function pollAll(deps: PollDeps): Promise<PollSummary> {
  const startedAt = new Date().toISOString();
  const sources = await dueSources(deps.db, deps.cfg);
  const sum: PollSummary = { startedAt, finishedAt: '', sources: sources.length, ok: 0, notModified: 0, unchanged: 0, failed: 0, newArticles: 0 };
  await forEachLimit(sources, deps.cfg.concurrency, async (s) => {
    if (deps.signal?.aborted) return;
    const r = await pollSource(deps, s).catch((err) => {
      deps.log.error('poll crashed', { source_id: s.id, err });
      return { outcome: 'failed' as const, inserted: 0 };
    });
    sum.newArticles += r.inserted;
    if (r.outcome === 'ok') sum.ok++;
    else if (r.outcome === 'not-modified') sum.notModified++;
    else if (r.outcome === 'unchanged') sum.unchanged++;
    else sum.failed++;
  });
  sum.finishedAt = new Date().toISOString();
  deps.log.info('poll finished', { ...sum });
  return sum;
}
