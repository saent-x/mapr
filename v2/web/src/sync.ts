import { merge, prune, SNAPSHOT_KEY, type StoredSnapshot } from './snapshot';
import { WINDOW_MS, type LiveMessage, type MaprEvent } from './types';

export interface EventsPage {
  count: number;
  next: string;
  more: boolean;
  events: MaprEvent[];
}

export type PageQuery = { since: string; after?: undefined } | { after: string; since?: undefined };

export interface SyncDeps {
  kv: KVNamespace;
  fetchPage: (q: PageQuery, limit: number) => Promise<EventsPage>;
  notify: (msg: LiveMessage) => Promise<void>;
  now?: number;
  pageLimit?: number;
  /** Upper bound on pages per run so one tick stays well inside the cron's CPU and subrequest limits. */
  maxPages?: number;
}

export interface SyncResult {
  pages: number;
  received: number;
  wrote: boolean;
  upserted: number;
  removed: number;
  more: boolean;
}

/** Cursor format is "<updated_at ISO>~<id>" (server.ts encodeCursor); only its time is read here. */
export function cursorTime(cursor: string): number {
  const t = Date.parse(cursor.split('~')[0] ?? '');
  return Number.isNaN(t) ? NaN : t;
}

export async function readSnapshot(kv: KVNamespace, cacheTtl?: number): Promise<StoredSnapshot | null> {
  const s = await kv.get<StoredSnapshot>(SNAPSHOT_KEY, cacheTtl ? { type: 'json', cacheTtl } : { type: 'json' });
  return s && s.v === 1 ? s : null;
}

/** Live messages go out in chunks so one socket frame stays small. */
export const LIVE_CHUNK = 100;

/**
 * One cron tick: page /v1/events from the stored cursor, merge into the 24h window,
 * write KV once (only if upstream returned anything), then tell LiveHub what changed.
 */
export async function runSync(d: SyncDeps): Promise<SyncResult> {
  const now = d.now ?? Date.now();
  const limit = d.pageLimit ?? 500;
  const maxPages = d.maxPages ?? 20;

  const stored = await readSnapshot(d.kv);
  let events = stored?.events ?? [];
  let cursor = stored?.cursor ?? null;
  // A cursor older than the window would replay events we would drop anyway: restart at the window edge.
  if (cursor && !(cursorTime(cursor) >= now - WINDOW_MS)) cursor = null;

  const upsert = new Map<number, MaprEvent>();
  const remove = new Set<number>();
  let pages = 0;
  let received = 0;
  let more = true;
  let failure: unknown;

  while (more && pages < maxPages) {
    let page: EventsPage;
    try {
      page = await d.fetchPage(cursor ? { after: cursor } : { since: new Date(now - WINDOW_MS).toISOString() }, limit);
    } catch (err) {
      failure = err;
      break;
    }
    pages++;
    more = page.more;
    if (page.events.length === 0) break;
    received += page.events.length;
    cursor = page.next;
    const r = merge(events, page.events, now);
    events = r.events;
    for (const e of r.upsert) {
      upsert.set(e.id, e);
      remove.delete(e.id);
    }
    for (const id of r.remove) {
      upsert.delete(id);
      remove.add(id);
    }
  }

  const wrote = received > 0;
  if (wrote) {
    const snap: StoredSnapshot = { v: 1, cursor, written_at: new Date(now).toISOString(), events: prune(events, now) };
    await d.kv.put(SNAPSHOT_KEY, JSON.stringify(snap));
  }

  if (upsert.size || remove.size) {
    const up = [...upsert.values()];
    const rm = [...remove];
    for (let i = 0; i < Math.max(up.length, 1); i += LIVE_CHUNK) {
      await d.notify({ type: 'events', upsert: up.slice(i, i + LIVE_CHUNK), remove: i === 0 ? rm : [] });
    }
  }

  if (failure) throw failure;
  return { pages, received, wrote, upserted: upsert.size, removed: remove.size, more };
}

/** fetchPage against the ingestor API (through the tunnel). */
export function ingestFetcher(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch): SyncDeps['fetchPage'] {
  return async (q, limit) => {
    const url = new URL('/v1/events', baseUrl);
    if (q.after) url.searchParams.set('after', q.after);
    else url.searchParams.set('since', q.since!);
    url.searchParams.set('limit', String(limit));
    const res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`ingest ${res.status} ${url.pathname}`);
    return (await res.json()) as EventsPage;
  };
}
