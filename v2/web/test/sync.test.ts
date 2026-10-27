import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { SNAPSHOT_KEY, type StoredSnapshot } from '../src/snapshot';
import { cursorTime, runSync, type EventsPage, type PageQuery } from '../src/sync';
import type { LiveMessage, MaprEvent } from '../src/types';
import { ev, hoursAgo, NOW } from './fixtures';

afterEach(() => reset());

/** In-process stand-in for GET /v1/events with the server's cursor semantics. */
function fakeIngest(rows: MaprEvent[]) {
  const calls: Array<PageQuery & { limit: number }> = [];
  const key = (e: MaprEvent) => [Date.parse(e.updated_at), e.id] as const;
  const gt = (a: readonly [number, number], b: readonly [number, number]) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  const fetchPage = async (q: PageQuery, limit: number): Promise<EventsPage> => {
    calls.push({ ...q, limit });
    const after: [number, number] = q.after
      ? [cursorTime(q.after), Number(q.after.split('~')[1])]
      : [Date.parse(q.since!), 0];
    const sorted = [...rows].sort((a, b) => key(a)[0] - key(b)[0] || a.id - b.id);
    const events = sorted.filter((e) => gt(key(e), after)).slice(0, limit);
    const last = events.at(-1);
    const next = last ? `${new Date(last.updated_at).toISOString()}~${last.id}` : `${new Date(after[0]).toISOString()}~${after[1]}`;
    return { count: events.length, next, more: events.length === limit, events };
  };
  return { rows, calls, fetchPage };
}

/** KV wrapper that counts writes. */
function countingKv() {
  let puts = 0;
  const kv = {
    get: (k: string, o: unknown) => env.SNAPSHOT.get(k, o as 'json'),
    put: (k: string, v: string) => {
      puts++;
      return env.SNAPSHOT.put(k, v);
    },
  } as unknown as KVNamespace;
  return { kv, puts: () => puts };
}

const stored = () => env.SNAPSHOT.get<StoredSnapshot>(SNAPSHOT_KEY, 'json');

describe('runSync', () => {
  it('first run starts at now-24h and pages with after= while more is true', async () => {
    const up = fakeIngest(Array.from({ length: 7 }, (_, i) => ev(i + 1, { updated_at: hoursAgo(10 - i) })));
    const { kv, puts } = countingKv();
    const sent: LiveMessage[] = [];
    const r = await runSync({ kv, fetchPage: up.fetchPage, notify: async (m) => void sent.push(m), now: NOW, pageLimit: 3 });

    expect(up.calls[0]).toEqual({ since: hoursAgo(24), limit: 3 });
    expect(up.calls.slice(1).every((c) => c.after && !c.since)).toBe(true);
    expect(up.calls).toHaveLength(3); // 3 + 3 + 1
    expect(r).toMatchObject({ pages: 3, received: 7, wrote: true, upserted: 7, more: false });
    expect(puts()).toBe(1);

    const s = await stored();
    expect(s?.events).toHaveLength(7);
    expect(s?.cursor).toBe(`${hoursAgo(4)}~7`);
    expect(sent.flatMap((m) => m.upsert).map((e) => e.id).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('resumes from the stored cursor and writes nothing when upstream has nothing new', async () => {
    const up = fakeIngest([ev(1, { updated_at: hoursAgo(3) })]);
    await runSync({ kv: env.SNAPSHOT, fetchPage: up.fetchPage, notify: async () => {}, now: NOW });

    const { kv, puts } = countingKv();
    const sent: LiveMessage[] = [];
    const r = await runSync({ kv, fetchPage: up.fetchPage, notify: async (m) => void sent.push(m), now: NOW });
    expect(up.calls.at(-1)).toEqual({ after: `${hoursAgo(3)}~1`, limit: 500 });
    expect(r).toMatchObject({ received: 0, wrote: false });
    expect(puts()).toBe(0);
    expect(sent).toEqual([]);
  });

  it('does not write or notify when only time passes (expiry alone is not a change)', async () => {
    const up = fakeIngest([ev(1, { updated_at: hoursAgo(23.9) })]);
    await runSync({ kv: env.SNAPSHOT, fetchPage: up.fetchPage, notify: async () => {}, now: NOW });
    const { kv, puts } = countingKv();
    const sent: LiveMessage[] = [];
    await runSync({ kv, fetchPage: up.fetchPage, notify: async (m) => void sent.push(m), now: NOW + 3_600_000 });
    expect(puts()).toBe(0);
    expect(sent).toEqual([]);
  });

  it('prunes expired events on the next write', async () => {
    const up = fakeIngest([ev(1, { updated_at: hoursAgo(23.9) })]);
    await runSync({ kv: env.SNAPSHOT, fetchPage: up.fetchPage, notify: async () => {}, now: NOW });
    up.rows.push(ev(2, { updated_at: hoursAgo(-0.5) }));
    await runSync({ kv: env.SNAPSHOT, fetchPage: up.fetchPage, notify: async () => {}, now: NOW + 3_600_000 });
    expect((await stored())?.events.map((e) => e.id)).toEqual([2]);
  });

  it('notifies only changed events; irrelevant ones advance the cursor but are not stored or sent', async () => {
    const up = fakeIngest([ev(1, { updated_at: hoursAgo(3) }), ev(2, { updated_at: hoursAgo(2) })]);
    await runSync({ kv: env.SNAPSHOT, fetchPage: up.fetchPage, notify: async () => {}, now: NOW });

    // event 1 updated with identical content, 2 turns irrelevant, 3 arrives irrelevant
    up.rows.splice(0, up.rows.length, ev(1, { updated_at: hoursAgo(3) }), ev(2, { updated_at: hoursAgo(1), relevant: false }), ev(3, { updated_at: hoursAgo(0.5), relevant: false }));
    const sent: LiveMessage[] = [];
    const r = await runSync({ kv: env.SNAPSHOT, fetchPage: up.fetchPage, notify: async (m) => void sent.push(m), now: NOW });

    expect(r).toMatchObject({ received: 2, wrote: true, upserted: 0, removed: 1 });
    expect(sent).toEqual([{ type: 'events', upsert: [], remove: [2] }]);
    const s = await stored();
    expect(s?.events.map((e) => e.id)).toEqual([1]);
    expect(s?.cursor).toBe(`${hoursAgo(0.5)}~3`);
  });

  it('restarts at the window edge when the stored cursor is older than 24h', async () => {
    const old: StoredSnapshot = { v: 1, cursor: `${hoursAgo(48)}~9`, written_at: hoursAgo(48), events: [ev(9, { updated_at: hoursAgo(48) })] };
    await env.SNAPSHOT.put(SNAPSHOT_KEY, JSON.stringify(old));
    const up = fakeIngest([ev(10, { updated_at: hoursAgo(1) })]);
    await runSync({ kv: env.SNAPSHOT, fetchPage: up.fetchPage, notify: async () => {}, now: NOW });
    expect(up.calls[0]).toEqual({ since: hoursAgo(24), limit: 500 });
    expect((await stored())?.events.map((e) => e.id)).toEqual([10]);
  });

  it('stops at maxPages and continues from there next tick', async () => {
    const up = fakeIngest(Array.from({ length: 5 }, (_, i) => ev(i + 1, { updated_at: hoursAgo(5 - i) })));
    const r1 = await runSync({ kv: env.SNAPSHOT, fetchPage: up.fetchPage, notify: async () => {}, now: NOW, pageLimit: 2, maxPages: 1 });
    expect(r1).toMatchObject({ pages: 1, more: true });
    const r2 = await runSync({ kv: env.SNAPSHOT, fetchPage: up.fetchPage, notify: async () => {}, now: NOW, pageLimit: 2 });
    expect(r2.received).toBe(3);
    expect((await stored())?.events).toHaveLength(5);
  });

  it('keeps pages fetched before an upstream error, then rethrows', async () => {
    const up = fakeIngest(Array.from({ length: 4 }, (_, i) => ev(i + 1, { updated_at: hoursAgo(5 - i) })));
    let n = 0;
    const flaky = async (q: PageQuery, limit: number) => {
      if (n++ === 1) throw new Error('tunnel down');
      return up.fetchPage(q, limit);
    };
    await expect(runSync({ kv: env.SNAPSHOT, fetchPage: flaky, notify: async () => {}, now: NOW, pageLimit: 2 })).rejects.toThrow('tunnel down');
    const s = await stored();
    expect(s?.events.map((e) => e.id).sort()).toEqual([1, 2]);
    expect(s?.cursor).toBe(`${hoursAgo(4)}~2`);
  });

  it('splits large change sets into chunks of 100', async () => {
    const up = fakeIngest(Array.from({ length: 250 }, (_, i) => ev(i + 1, { updated_at: hoursAgo(10 - i / 100) })));
    const sent: LiveMessage[] = [];
    await runSync({ kv: env.SNAPSHOT, fetchPage: up.fetchPage, notify: async (m) => void sent.push(m), now: NOW });
    expect(sent.map((m) => m.upsert.length)).toEqual([100, 100, 50]);
  });
});
