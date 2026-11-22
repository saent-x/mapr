import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, reset } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleScheduled } from '../src/index';
import { SNAPSHOT_KEY, type StoredSnapshot } from '../src/snapshot';
import type { EventsResponse, LiveMessage } from '../src/types';
import { ev } from './fixtures';

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

async function openSocket() {
  const res = await exports.default.fetch('http://desk/live', { headers: { upgrade: 'websocket' } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const messages: string[] = [];
  ws.addEventListener('message', (m) => {
    messages.push(m.data as string);
  });
  return { ws, messages };
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe('GET /api/events', () => {
  it('serves the snapshot sorted by severity desc then updated_at desc, without expired events', async () => {
    const snap: StoredSnapshot = {
      v: 1,
      cursor: 'c',
      written_at: ago(0.1),
      events: [
        ev(1, { severity: 1, updated_at: ago(1) }),
        ev(2, { severity: 3, updated_at: ago(5) }),
        ev(3, { severity: 3, updated_at: ago(2) }),
        ev(4, { severity: null, updated_at: ago(0.5) }),
        ev(5, { severity: 4, updated_at: ago(30) }),
      ],
    };
    await env.SNAPSHOT.put(SNAPSHOT_KEY, JSON.stringify(snap));
    const res = await exports.default.fetch('http://desk/api/events');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/max-age=15/);
    const body = (await res.json()) as EventsResponse;
    expect(body.events.map((e) => e.id)).toEqual([3, 2, 1, 4]);
    expect(body.written_at).toBe(snap.written_at);
  });

  it('serves an empty list before the first sync', async () => {
    const body = (await (await exports.default.fetch('http://desk/api/events')).json()) as EventsResponse;
    expect(body).toEqual({ written_at: null, events: [] });
  });
});

describe('GET /healthz', () => {
  it('reports snapshot age', async () => {
    await env.SNAPSHOT.put(SNAPSHOT_KEY, JSON.stringify({ v: 1, cursor: 'c', written_at: ago(0.5), events: [ev(1)] }));
    const body = (await (await exports.default.fetch('http://desk/healthz')).json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.events).toBe(1);
    expect(Math.abs((body.snapshot_age_s as number) - 1800)).toBeLessThan(5);
  });
});

describe('LiveHub', () => {
  it('rejects non-websocket requests to /live', async () => {
    expect((await exports.default.fetch('http://desk/live')).status).toBe(426);
  });

  it('broadcasts to every connected socket', async () => {
    const a = await openSocket();
    const b = await openSocket();
    const stub = env.LIVE.get(env.LIVE.idFromName('global'));
    expect(await stub.broadcast('{"hello":1}')).toBe(2);
    await until(() => a.messages.length === 1 && b.messages.length === 1);
    expect(a.messages[0]).toBe('{"hello":1}');

    a.ws.close(1000);
    b.ws.close(1000);
  });

  it('keeps sockets across hibernation', async () => {
    const a = await openSocket();
    const stub = env.LIVE.get(env.LIVE.idFromName('global'));
    expect(await stub.broadcast('one')).toBe(1);
    await evictDurableObject(stub, { webSockets: 'hibernate' });
    expect(await stub.broadcast('two')).toBe(1);
    await until(() => a.messages.join() === 'one,two');
    a.ws.close(1000);
  });

  it('answers ping without a broadcast', async () => {
    const a = await openSocket();
    a.ws.send('ping');
    await until(() => a.messages.includes('pong'));
    a.ws.close(1000);
  });

  it('cron tick pulls from the ingestor and pushes changes to sockets', async () => {
    const page = { count: 1, next: `${ago(0.2)}~42`, more: false, events: [ev(42, { updated_at: ago(0.2), severity: 4 })] };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin + url.pathname).toBe('https://ingest.test/v1/events');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-token');
      return Response.json(page);
    });
    const a = await openSocket();

    const r = await handleScheduled(env);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ received: 1, wrote: true, upserted: 1 });

    await until(() => a.messages.length === 1);
    const msg = JSON.parse(a.messages[0]!) as LiveMessage;
    expect(msg.type).toBe('events');
    expect(msg.upsert.map((e) => e.id)).toEqual([42]);

    const body = (await (await exports.default.fetch('http://desk/api/events')).json()) as EventsResponse;
    expect(body.events.map((e) => e.id)).toEqual([42]);
    a.ws.close(1000);
  });
});
