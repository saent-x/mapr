import { WINDOW_MS, type MaprEvent } from './types';

/** What lives in KV under SNAPSHOT_KEY: the rolling 24h window plus the ingest cursor, in one value (one write). */
export interface StoredSnapshot {
  v: 1;
  /** Opaque `next` from the last /v1/events page, or null before the first event. */
  cursor: string | null;
  written_at: string;
  events: MaprEvent[];
}

export const SNAPSHOT_KEY = 'snapshot:v1';

export interface MergeResult {
  events: MaprEvent[];
  upsert: MaprEvent[];
  remove: number[];
}

const ts = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

export const isFresh = (e: MaprEvent, now: number): boolean => ts(e.updated_at) >= now - WINDOW_MS;

/** Drop events that left the 24h window. Not a change on its own: readers apply the same filter. */
export function prune(events: MaprEvent[], now: number): MaprEvent[] {
  return events.filter((e) => isFresh(e, now));
}

/**
 * Merge a batch from /v1/events into the window. relevant === false removes an event;
 * anything older than 24h is dropped. upsert/remove list only real changes.
 */
export function merge(prev: MaprEvent[], incoming: MaprEvent[], now: number): MergeResult {
  const byId = new Map<number, MaprEvent>();
  for (const e of prune(prev, now)) byId.set(e.id, e);

  const upsert = new Map<number, MaprEvent>();
  const remove = new Set<number>();

  for (const e of incoming) {
    const had = byId.get(e.id);
    if (e.relevant === false || !isFresh(e, now)) {
      if (had) {
        byId.delete(e.id);
        upsert.delete(e.id);
        remove.add(e.id);
      }
      continue;
    }
    if (had && JSON.stringify(had) === JSON.stringify(e)) continue;
    byId.set(e.id, e);
    upsert.set(e.id, e);
    remove.delete(e.id);
  }

  return { events: sortEvents([...byId.values()]), upsert: [...upsert.values()], remove: [...remove] };
}

/** Severity desc (unscored last), then updated_at desc, then id desc. */
export function compareEvents(a: MaprEvent, b: MaprEvent): number {
  return (b.severity ?? 0) - (a.severity ?? 0) || ts(b.updated_at) - ts(a.updated_at) || b.id - a.id;
}

export function sortEvents(events: MaprEvent[]): MaprEvent[] {
  return events.sort(compareEvents);
}
