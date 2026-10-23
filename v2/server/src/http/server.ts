import { createHash, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import type { PollSummary } from '../ingest/poller.js';

export interface AppState {
  startedAt: Date;
  lastPoll: PollSummary | null;
  pollRunning: boolean;
}

export interface ApiOptions {
  db: Db;
  state: AppState;
  apiToken: string | undefined;
  failSkipThreshold: number;
  log: Logger;
}

const MAX_LIMIT = 500;

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(json),
  });
  res.end(json);
}

const digest = (s: string) => createHash('sha256').update(s).digest();

export function authorized(header: string | undefined, token: string | undefined): boolean {
  if (!token) return false; // no token configured: /v1 stays closed
  const m = header?.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  return timingSafeEqual(digest(m[1]!.trim()), digest(token));
}

export async function health(o: ApiOptions): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const [src, q] = await Promise.all([
      o.db.query<{ enabled: number; ok: number; failing: number; skipped: number }>(
        `SELECT count(*) FILTER (WHERE enabled)::int AS enabled,
                count(*) FILTER (WHERE enabled AND fail_count = 0)::int AS ok,
                count(*) FILTER (WHERE enabled AND fail_count > 0)::int AS failing,
                count(*) FILTER (WHERE enabled AND fail_count >= $1)::int AS skipped
         FROM sources WHERE kind = 'rss'`,
        [o.failSkipThreshold],
      ),
      o.db.query<{ depth: number; ready: number; running: number; held: number; dead: number }>(
        `SELECT count(*) FILTER (WHERE attempts < 8)::int AS depth,
                count(*) FILTER (WHERE attempts < 8 AND locked_at IS NULL AND run_after <= now())::int AS ready,
                count(*) FILTER (WHERE locked_at IS NOT NULL)::int AS running,
                count(*) FILTER (WHERE attempts < 8 AND locked_at IS NULL AND run_after > now())::int AS held,
                count(*) FILTER (WHERE attempts >= 8)::int AS dead
         FROM jobs`,
      ),
    ]);
    return {
      status: 200,
      body: {
        ok: true,
        db: 'ok',
        uptime_s: Math.round((Date.now() - o.state.startedAt.getTime()) / 1000),
        last_poll: o.state.lastPoll,
        poll_running: o.state.pollRunning,
        sources: src.rows[0],
        queue: q.rows[0],
      },
    };
  } catch (err) {
    o.log.warn('healthz db check failed', { err });
    return { status: 503, body: { ok: false, db: 'error', last_poll: o.state.lastPoll } };
  }
}

export async function listEvents(db: Db, since: Date, limit: number): Promise<unknown[]> {
  const r = await db.query(
    `SELECT e.id, e.title, e.summary, e.first_seen, e.last_seen, ea.updated_at,
            e.severity, e.severity_conf, e.relevant, e.relevance_conf, e.category, e.place, e.country, e.lat, e.lon,
            e.facts, e.source_count, e.article_count, e.triaged_at, e.pinned,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'source_id', es.source_id, 'source', s.name, 'region', s.region, 'url', es.url,
                       'title', es.title, 'published_at', es.published_at, 'span', es.span)
                     ORDER BY es.published_at DESC NULLS LAST, es.url)
              FROM event_sources es JOIN sources s ON s.id = es.source_id
              WHERE es.event_id = e.id), '[]'::json) AS sources
     FROM event_activity ea JOIN events e ON e.id = ea.event_id
     WHERE ea.updated_at > $1
     ORDER BY ea.updated_at DESC, e.id DESC
     LIMIT $2`,
    [since, limit],
  );
  return r.rows.map((row) => ({ ...row, id: Number(row.id) }));
}

export function createApiServer(o: ApiOptions): http.Server {
  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
      if (url.pathname === '/healthz') {
        const h = await health(o);
        return send(res, h.status, h.body);
      }
      if (url.pathname.startsWith('/v1/')) {
        if (!o.apiToken) return send(res, 503, { error: 'API_TOKEN not configured' });
        if (!authorized(req.headers.authorization, o.apiToken)) {
          res.setHeader('www-authenticate', 'Bearer');
          return send(res, 401, { error: 'unauthorized' });
        }
        if (url.pathname === '/v1/events') {
          const sinceRaw = url.searchParams.get('since');
          const since = sinceRaw ? new Date(sinceRaw) : new Date(Date.now() - 24 * 3_600_000);
          if (Number.isNaN(since.getTime())) return send(res, 400, { error: 'since must be an ISO 8601 timestamp' });
          const limitRaw = Number(url.searchParams.get('limit') ?? 100);
          if (!Number.isInteger(limitRaw) || limitRaw < 1) return send(res, 400, { error: 'limit must be a positive integer' });
          const limit = Math.min(limitRaw, MAX_LIMIT);
          const events = await listEvents(o.db, since, limit);
          const cursor = events.length ? (events[0] as { updated_at: Date }).updated_at : since;
          return send(res, 200, { since: since.toISOString(), limit, count: events.length, cursor, events });
        }
      }
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      o.log.error('http handler error', { path: url.pathname, err });
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
    } finally {
      o.log.debug('http', { method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}
