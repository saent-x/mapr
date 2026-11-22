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
  /** Events left out of KV because the snapshot was over MAX_SNAPSHOT_BYTES. */
  dropped: number;
}

/** Cursor format is "<updated_at ISO, up to microseconds>~<id>" (server.ts encodeCursor); only its time is read here. */
export function cursorTime(cursor: string): number {
  const t = Date.parse((cursor.split('~')[0] ?? '').replace(/(\.\d{3})\d+Z$/, '$1Z'));
  return Number.isNaN(t) ? NaN : t;
}

export async function readSnapshot(kv: KVNamespace, cacheTtl?: number): Promise<StoredSnapshot | null> {
  const s = await kv.get<StoredSnapshot>(SNAPSHOT_KEY, cacheTtl ? { type: 'json', cacheTtl } : { type: 'json' });
  return s && s.v === 1 ? s : null;
}

/** KV caps one value at 25 MiB; stay well under it so the cursor is always saved. */
export const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;

/**
 * Serialise the snapshot, dropping the lowest-ranked events (events are kept sorted by
 * compareEvents) until it fits. Returns the JSON and how many events were left out.
 */
export function encodeSnapshot(snap: StoredSnapshot, maxBytes = MAX_SNAPSHOT_BYTES): { body: string; dropped: number } {
  let body = JSON.stringify(snap);
  let keep = snap.events.length;
  while (body.length > maxBytes && keep > 0) {
    keep = Math.floor(keep * Math.min(0.95, maxBytes / body.length));
    body = JSON.stringify({ ...snap, events: snap.events.slice(0, keep) });
  }
  return { body, dropped: snap.events.length - keep };
}

/** Live messages go out in chunks so one socket frame stays small. */
export const LIVE_CHUNK = 100;

/**
 * One cron tick: page /v1/events from the stored cursor, merge into the 24h window,
 * write KV once (only if the window or the cursor moved), then tell LiveHub what changed.
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

  // Write only when the window or the cursor moved: an unchanged snapshot is not worth a KV write.
  const wrote = received > 0 && (upsert.size > 0 || remove.size > 0 || cursor !== (stored?.cursor ?? null));
  let dropped = 0;
  if (wrote) {
    const snap: StoredSnapshot = { v: 1, cursor, written_at: new Date(now).toISOString(), events: prune(events, now) };
    const enc = encodeSnapshot(snap);
    dropped = enc.dropped;
    if (dropped) console.warn(JSON.stringify({ msg: 'snapshot over size, lowest-ranked events left out', dropped }));
    await d.kv.put(SNAPSHOT_KEY, enc.body);
  }

  if (upsert.size || remove.size) {
    const up = [...upsert.values()];
    const rm = [...remove];
    for (let i = 0; i < Math.max(up.length, 1); i += LIVE_CHUNK) {
      await d.notify({ type: 'events', upsert: up.slice(i, i + LIVE_CHUNK), remove: i === 0 ? rm : [] });
    }
  }

  if (failure) throw failure;
  return { pages, received, wrote, upserted: upsert.size, removed: remove.size, more, dropped };
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
