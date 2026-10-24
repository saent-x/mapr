import type { Env } from './env';
import { hub } from './live';
import { sortEvents, prune } from './snapshot';
import { ingestFetcher, readSnapshot, runSync } from './sync';
import type { EventsResponse } from './types';

export { LiveHub } from './live';

const json = (body: unknown, init: ResponseInit = {}, cache = 'no-store') =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, 'x-content-type-options': 'nosniff', ...init.headers },
  });

export async function handleFetch(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === '/live') {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
    return hub(env).fetch(req);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return json({ error: 'method not allowed' }, { status: 405 });

  if (url.pathname === '/api/events') {
    const snap = await readSnapshot(env.SNAPSHOT, 30);
    const body: EventsResponse = {
      written_at: snap?.written_at ?? null,
      events: snap ? sortEvents(prune(snap.events, Date.now())) : [],
    };
    return json(body, {}, 'public, max-age=15, stale-while-revalidate=30');
  }

  if (url.pathname === '/healthz') {
    const snap = await readSnapshot(env.SNAPSHOT, 30);
    const age = snap ? Math.max(0, Math.round((Date.now() - Date.parse(snap.written_at)) / 1000)) : null;
    return json({ ok: true, snapshot_age_s: age, events: snap?.events.length ?? 0, cursor: snap?.cursor ?? null });
  }

  return json({ error: 'not found' }, { status: 404 });
}

export async function handleScheduled(env: Env, now = Date.now()) {
  if (!env.INGEST_TOKEN) throw new Error('INGEST_TOKEN is not set');
  const live = hub(env);
  const r = await runSync({
    kv: env.SNAPSHOT,
    fetchPage: ingestFetcher(env.INGEST_URL, env.INGEST_TOKEN),
    notify: async (msg) => {
      await live.broadcast(JSON.stringify(msg));
    },
    now,
  });
  console.log(JSON.stringify({ msg: 'sync', ...r }));
  return r;
}

export default {
  fetch: (req, env) => handleFetch(req, env),
  scheduled: async (controller, env) => {
    await handleScheduled(env, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
