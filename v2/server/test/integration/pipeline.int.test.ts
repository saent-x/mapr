// End-to-end against a real ParadeDB: store -> near-dup -> embed -> cluster
// -> triage jobs -> job runner with budget gate -> local API.
import type { AddressInfo } from 'node:net';
import { MockAgent } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clusterPending, type ClusterConfig } from '../../src/cluster/pipeline.js';
import { cosine } from '../../src/cluster/decide.js';
import { applyMigrations, createPool, type Db } from '../../src/db.js';
import { embedText, HttpEmbedder } from '../../src/embed/client.js';
import type { ParsedItem } from '../../src/feeds/parse.js';
import { createApiServer } from '../../src/http/server.js';
import { dueSources, pollSource, type PollConfig } from '../../src/ingest/poller.js';
import { storeItems } from '../../src/ingest/store.js';
import { BudgetGate, recordNeurons } from '../../src/jobs/budget.js';
import { enqueue } from '../../src/jobs/queue.js';
import { JobRunner } from '../../src/jobs/runner.js';
import { triageHandlers, type TriageEvent } from '../../src/jobs/triage.js';
import { log as rootLog, setLogLevel } from '../../src/log.js';
import { seedSources } from '../../src/seed.js';
import { fakeVector, startFakeEmbedder } from '../helpers/fakeEmbedder.js';
import { dockerAvailable, MIGRATIONS_DIR, startDb, type TestDb } from '../helpers/pg.js';

const HAVE_DB = dockerAvailable();
if (!HAVE_DB) console.warn('integration tests skipped: no Docker daemon and no TEST_DATABASE_URL');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const H = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * H);
const item = (link: string, title: string, lead: string, publishedAt: Date | null = ago(1)): ParsedItem => ({
  title,
  link,
  lead,
  bodyText: lead,
  publishedAt,
});

const QUAKE = {
  title: 'Magnitude 6.1 earthquake strikes northern Chile coast',
  lead: 'The quake struck at a depth of 35 km early on Tuesday, the US Geological Survey said, cutting power to thousands of homes near Antofagasta.',
};
const QUAKE_SYNDICATED = {
  title: QUAKE.title,
  lead: QUAKE.lead + ' Officials said there were no immediate reports of casualties.',
};
const QUAKE_REWRITE = {
  title: 'Magnitude 6.1 earthquake strikes coast of northern Chile',
  lead: 'The quake struck early on Tuesday at a depth of 35 km, the US Geological Survey said, cutting power to thousands of homes near Antofagasta city.',
};
const BUDGET = {
  title: 'Parliament passes budget after marathon session',
  lead: 'Lawmakers approved the spending plan by a narrow margin late on Monday following weeks of coalition talks over defence funding.',
};

describe.skipIf(!HAVE_DB)('pipeline against ParadeDB', () => {
  let tdb: TestDb;
  let db: Db;
  let emb: Awaited<ReturnType<typeof startFakeEmbedder>>;
  let cfg: ClusterConfig;
  let src: Record<string, number>;
  const log = rootLog.child({ test: 'int' });

  beforeAll(async () => {
    setLogLevel('error');
    tdb = await startDb();
    db = createPool(tdb.url, 6);
    expect(await applyMigrations(db, MIGRATIONS_DIR)).toContain('0002_ingestor.sql');
    expect(await applyMigrations(db, MIGRATIONS_DIR)).toEqual([]); // recorded, not re-applied
    emb = await startFakeEmbedder();
    cfg = { threshold: 0.82, windowHours: 48, lookbackDays: 7, nearDupThreshold: 0.6, embedBatch: 32 };
    await seedSources(db, [
      { name: 'Wire A', url: 'https://a.example/rss', kind: 'rss', region: 'GLOBAL' },
      { name: 'Wire B', url: 'https://b.example/rss', kind: 'rss', region: 'GLOBAL' },
      { name: 'Wire C', url: 'https://c.example/rss', kind: 'rss', region: 'LATAM' },
      { name: 'Wire D', url: 'https://d.example/rss', kind: 'rss', region: 'EU' },
      { name: 'GDELT', url: 'conflict OR protest', kind: 'gdelt', region: 'GLOBAL' },
    ]);
    const r = await db.query<{ id: number; name: string }>('SELECT id, name FROM sources');
    src = Object.fromEntries(r.rows.map((x) => [x.name, x.id]));
  });

  afterAll(async () => {
    await emb?.close();
    await db?.end();
    await tdb?.stop();
  });

  const embedder = () => new HttpEmbedder({ url: emb.url, batchSize: 32, backoffMs: 1 });
  const run = () => clusterPending({ db, embedder: embedder(), cfg, log });

  it('test texts behave as intended under the fake embedder', () => {
    const v = (x: { title: string; lead: string }) => fakeVector(embedText(x.title, x.lead));
    expect(cosine(v(QUAKE), v(QUAKE_REWRITE))).toBeGreaterThanOrEqual(0.82);
    expect(cosine(v(QUAKE), v(BUDGET))).toBeLessThan(0.5);
  });

  it('seeds sources idempotently, GDELT disabled', async () => {
    const again = await seedSources(db, [{ name: 'Wire A (renamed)', url: 'https://a.example/rss', kind: 'rss', region: 'GLOBAL' }]);
    expect(again).toEqual({ inserted: 0, updated: 1 });
    const g = await db.query(`SELECT enabled FROM sources WHERE kind = 'gdelt'`);
    expect(g.rows[0].enabled).toBe(false);
  });

  it('dedups exact URLs after canonicalisation', async () => {
    const a = await storeItems(db, src['Wire A']!, [item('https://a.example/quake?utm_source=rss#x', QUAKE.title, QUAKE.lead)], { preferHttps: true, lang: 'en' });
    expect(a.inserted).toBe(1);
    const again = await storeItems(db, src['Wire B']!, [item('http://A.example/quake/?fbclid=1', QUAKE.title, QUAKE.lead)], { preferHttps: true, lang: 'en' });
    expect(again.inserted).toBe(0);
    const row = await db.query(`SELECT url, array_length(minhash, 1) AS n FROM articles`);
    expect(row.rows).toEqual([{ url: 'https://a.example/quake', n: 128 }]);
    const bands = await db.query('SELECT count(*)::int AS n FROM article_bands');
    expect(bands.rows[0].n).toBe(32);
  });

  it('clusters into events: near-dup attaches, similar joins, unrelated creates', async () => {
    await storeItems(db, src['Wire B']!, [item('https://b.example/world/chile-quake', QUAKE_SYNDICATED.title, QUAKE_SYNDICATED.lead)], { preferHttps: true, lang: 'en' });
    await storeItems(db, src['Wire C']!, [item('https://c.example/chile', QUAKE_REWRITE.title, QUAKE_REWRITE.lead)], { preferHttps: true, lang: 'en' });
    await storeItems(db, src['Wire A']!, [item('https://a.example/budget', BUDGET.title, BUDGET.lead)], { preferHttps: true, lang: 'en' });

    const before = emb.calls.flat().length;
    const s = await run();
    expect(s).toEqual({ created: 2, joined: 1, nearDup: 1, skipped: 0, failed: 0 });
    // The near-duplicate was never embedded.
    expect(emb.calls.flat().length - before).toBe(3);

    const ev = await db.query(`SELECT id, title, article_count, source_count, centroid IS NOT NULL AS has_c FROM events ORDER BY id`);
    expect(ev.rows).toHaveLength(2);
    const [quake, budget] = ev.rows;
    expect(quake).toMatchObject({ title: QUAKE.title, article_count: 3, source_count: 3, has_c: true });
    expect(budget).toMatchObject({ title: BUDGET.title, article_count: 1, source_count: 1 });

    const es = await db.query(`SELECT source_id, url, span FROM event_sources WHERE event_id = $1 ORDER BY url`, [quake.id]);
    expect(es.rows.map((r) => r.url)).toEqual(['https://a.example/quake', 'https://b.example/world/chile-quake', 'https://c.example/chile']);
    expect(es.rows.every((r) => r.span.length <= 300)).toBe(true);

    const jobs = await db.query(`SELECT kind, dedupe_key, payload FROM jobs ORDER BY id`);
    expect(jobs.rows.map((j) => [j.kind, j.dedupe_key])).toEqual([
      ['triage', `triage:${quake.id}:1`],
      ['re-triage', `triage:${quake.id}:3`],
      ['triage', `triage:${budget.id}:1`],
    ]);
    const pending = await db.query('SELECT count(*)::int AS n FROM articles WHERE event_id IS NULL');
    expect(pending.rows[0].n).toBe(0);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const snap = async () =>
      (await db.query(`SELECT id, article_count, source_count, centroid::text AS c FROM events ORDER BY id`)).rows;
    const before = await snap();
    expect(await run()).toEqual({ created: 0, joined: 0, nearDup: 0, skipped: 0, failed: 0 });
    expect(await snap()).toEqual(before);
    expect((await db.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n).toBe(3);
  });

  it('stores back-catalogue stories older than 48h without triaging them', async () => {
    const title = 'Harbour authority publishes annual dredging report';
    const lead = 'The harbour authority released its annual report on channel dredging, sediment volumes and maintenance spending for the past year.';
    await storeItems(db, src['Wire D']!, [item('https://d.example/dredging-report', title, lead, ago(24 * 10))], { preferHttps: true, lang: 'en' });
    const jobsBefore = (await db.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n;
    expect((await run()).created).toBe(1);
    const ev = await db.query('SELECT id FROM events WHERE title = $1', [title]);
    expect(ev.rows).toHaveLength(1);
    expect((await db.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n).toBe(jobsBefore);
    await db.query('DELETE FROM articles WHERE event_id = $1', [ev.rows[0].id]);
    await db.query('DELETE FROM events WHERE id = $1', [ev.rows[0].id]);
  });

  it('keeps events across days and runs, but not beyond the 48h window', async () => {
    const story = (x: string) => ({
      title: `Wildfire forces evacuation of ${x} mountain towns`,
      lead: `Firefighters battled a fast moving wildfire near the ${x} mountain towns as strong winds pushed flames toward homes and roads were closed.`,
      // Rewritten, not syndicated: few shared shingles (no MinHash near-duplicate), similar meaning.
      lead2: `Roads were closed near the ${x} mountain towns, where firefighters battled flames from a fast moving wildfire pushed toward homes by strong winds.`,
    });
    const d = story('Sierra');
    const v = (t: string, l: string) => fakeVector(embedText(t, l));
    expect(cosine(v(d.title, d.lead), v(`${d.title} overnight`, d.lead2))).toBeGreaterThanOrEqual(0.82);
    await storeItems(db, src['Wire A']!, [item('https://a.example/fire-1', d.title, d.lead, ago(40))], { preferHttps: true, lang: 'en' });
    await run();
    // Separate run, 40h later, different source and wording: same event.
    await storeItems(db, src['Wire D']!, [item('https://d.example/fire-2', `${d.title} overnight`, d.lead2, ago(0))], { preferHttps: true, lang: 'en' });
    const s1 = await run();
    expect(s1).toMatchObject({ joined: 1, nearDup: 0, created: 0 });

    const e = {
      title: 'River floods cut off villages in the Andes valley',
      lead: 'Swollen rivers washed away bridges and cut off remote villages in the Andes valley after days of heavy rain, emergency services said.',
      lead2: 'Emergency services said remote villages in the Andes valley were cut off after heavy rain for days swelled rivers that washed away bridges.',
    };
    expect(cosine(v(e.title, e.lead), v(`${e.title} overnight`, e.lead2))).toBeGreaterThanOrEqual(0.82);
    await storeItems(db, src['Wire A']!, [item('https://a.example/fire-andes-1', e.title, e.lead, ago(100))], { preferHttps: true, lang: 'en' });
    await run();
    await storeItems(db, src['Wire C']!, [item('https://c.example/fire-andes-2', `${e.title} overnight`, e.lead2, ago(0))], { preferHttps: true, lang: 'en' });
    const s2 = await run();
    expect(s2).toMatchObject({ created: 1, joined: 0 });

    const fires = await db.query(`SELECT title, article_count, first_seen, last_seen FROM events WHERE title LIKE 'Wildfire%' OR title LIKE 'River floods%' ORDER BY id`);
    expect(fires.rows.map((r) => r.article_count)).toEqual([2, 1, 1]);
    expect(fires.rows[0].last_seen.getTime() - fires.rows[0].first_seen.getTime()).toBeGreaterThan(39 * H);
  });

  it('runs triage jobs through the budget gate, holding them when the ceiling is reached', async () => {
    const seen: TriageEvent[] = [];
    const runner = new JobRunner(db, { budget: new BudgetGate(db, 9000), log, baseBackoffMs: 1000 });
    for (const h of triageHandlers(db, { triageEvent: async (e) => void seen.push(e) })) runner.register(h);

    await recordNeurons(db, 6000);
    await db.query(`INSERT INTO ai_usage (day, account_neurons) VALUES ((now() AT TIME ZONE 'UTC')::date, 3000)
                    ON CONFLICT (day) DO UPDATE SET account_neurons = 3000`);
    const ready = (await db.query(`SELECT count(*)::int AS n FROM jobs WHERE run_after <= now()`)).rows[0].n;
    expect(ready).toBeGreaterThan(0);
    expect(await runner.runOnce()).toBe('deferred');
    expect(seen).toHaveLength(0);
    const held = await db.query(`SELECT run_after, attempts, locked_at FROM jobs`);
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    for (const j of held.rows) {
      expect(j.run_after.getTime()).toBe(midnight.getTime());
      expect(j.attempts).toBe(0);
      expect(j.locked_at).toBeNull();
    }
    expect(await runner.runOnce()).toBe('idle');

    // Next UTC day: budget resets.
    await db.query(`UPDATE ai_usage SET mapr_neurons = 0, account_neurons = 0`);
    await db.query(`UPDATE jobs SET run_after = now()`);
    let n = 0;
    while ((await runner.runOnce()) === 'done') n++;
    expect(n).toBe(ready);
    expect((await db.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n).toBe(0);
    const quake = seen.find((e) => e.title === QUAKE.title && e.milestone === 3)!;
    expect(quake.sources.map((s) => s.source).sort()).toEqual(['Wire A (renamed)', 'Wire B', 'Wire C']);
  });

  it('retries failing jobs with backoff and stops after 8 attempts; SKIP LOCKED never double-runs', async () => {
    let calls = 0;
    const runner = new JobRunner(db, { budget: new BudgetGate(db, 9000), log, baseBackoffMs: 1000 });
    runner.register({ kind: 'flaky', ai: false, run: async () => { calls++; throw new Error('boom'); } });
    await enqueue(db, 'flaky', {}, 'flaky:1');
    expect(await enqueue(db, 'flaky', {}, 'flaky:1')).toBeNull();

    expect(await runner.runOnce()).toBe('retry');
    const j = (await db.query(`SELECT attempts, last_error, run_after - now() AS wait FROM jobs WHERE kind = 'flaky'`)).rows[0];
    expect(j.attempts).toBe(1);
    expect(j.last_error).toBe('boom');
    expect(await runner.runOnce()).toBe('idle'); // backing off
    for (let i = 2; i <= 8; i++) {
      await db.query(`UPDATE jobs SET run_after = now() WHERE kind = 'flaky'`);
      expect(await runner.runOnce()).toBe(i === 8 ? 'dead' : 'retry');
    }
    await db.query(`UPDATE jobs SET run_after = now() WHERE kind = 'flaky'`);
    expect(await runner.runOnce()).toBe('idle');
    expect(calls).toBe(8);

    let slow = 0;
    const r2 = new JobRunner(db, { budget: new BudgetGate(db, 9000), log });
    r2.register({ kind: 'slow', ai: false, run: async () => { slow++; await new Promise((r) => setTimeout(r, 300)); } });
    await enqueue(db, 'slow', {}, 'slow:1');
    const outcomes = await Promise.all([r2.runOnce(), r2.runOnce(), r2.runOnce()]);
    expect(outcomes.filter((o) => o === 'done')).toHaveLength(1);
    expect(slow).toBe(1);
  });

  it('polls a feed: inserts, 304, failure counting and auto-skip', async () => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    const pcfg: PollConfig = { concurrency: 4, timeoutMs: 2000, maxBodyBytes: 1_000_000, maxRedirects: 3, userAgent: 't', failSkipThreshold: 12, reprobeHours: 24 };
    const deps = { db, cfg: pcfg, log, fetchOverrides: { dispatcher: agent, resolver: async () => ['93.184.216.34'] } };
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>D</title>
      <item><title>Port strike halts container traffic</title><link>http://d.example/port-strike?utm_source=x</link>
      <pubDate>${new Date().toUTCString()}</pubDate><description>Dock workers walked out.</description></item></channel></rss>`;
    const o = agent.get('https://d.example');
    o.intercept({ path: '/rss' }).reply(200, rss, { headers: { etag: '"v1"', 'content-type': 'application/rss+xml' } });
    o.intercept({ path: '/rss', headers: { 'if-none-match': '"v1"' } }).reply(304, '');
    o.intercept({ path: '/rss' }).reply(500, 'down').times(12);

    const source = async () => (await dueSources(db, pcfg)).find((s) => s.url === 'https://d.example/rss');
    expect(await pollSource(deps, (await source())!)).toEqual({ outcome: 'ok', inserted: 1 });
    const art = await db.query(`SELECT url FROM articles WHERE url LIKE '%port-strike%'`);
    expect(art.rows[0].url).toBe('https://d.example/port-strike'); // https: the feed was served over https
    expect(await pollSource(deps, (await source())!)).toEqual({ outcome: 'not-modified', inserted: 0 });
    for (let i = 0; i < 12; i++) expect((await pollSource(deps, (await source())!)).outcome).toBe('failed');
    const s = await db.query(`SELECT fail_count, last_error, etag, last_ok_at FROM sources WHERE url = 'https://d.example/rss'`);
    expect(s.rows[0]).toMatchObject({ fail_count: 12, last_error: 'FetchError: HTTP 500', etag: '"v1"' });
    expect(await source()).toBeUndefined(); // auto-skipped
    await db.query(`UPDATE source_polls SET last_attempt_at = now() - interval '25 hours'`);
    expect(await source()).toBeDefined(); // daily re-probe
    await agent.close();
  });

  it('serves /healthz and /v1/events with bearer auth', async () => {
    const state = { startedAt: new Date(), lastPoll: null, pollRunning: false };
    const server = createApiServer({ db, state, apiToken: 'secret-token', failSkipThreshold: 12, log });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const h = await fetch(`${base}/healthz`);
      expect(h.status).toBe(200);
      const hb = (await h.json()) as Json;
      expect(hb).toMatchObject({ ok: true, db: 'ok', sources: { enabled: 4, failing: 1, skipped: 1 } });
      expect(hb.queue.depth).toBeGreaterThanOrEqual(0);

      expect((await fetch(`${base}/v1/events`)).status).toBe(401);
      expect((await fetch(`${base}/v1/events`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
      const r = await fetch(`${base}/v1/events?since=${encodeURIComponent(ago(1).toISOString())}&limit=2`, {
        headers: { authorization: 'Bearer secret-token' },
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as Json;
      expect(body.count).toBe(2);
      expect(body.events[0].sources.length).toBeGreaterThan(0);
      expect(body.events[0]).not.toHaveProperty('centroid');
      const all = (await (await fetch(`${base}/v1/events?limit=100`, { headers: { authorization: 'Bearer secret-token' } })).json()) as Json;
      const quake = all.events.find((e: { title: string }) => e.title === QUAKE.title);
      expect(quake.sources).toHaveLength(3);
      expect((await fetch(`${base}/v1/events?since=nope`, { headers: { authorization: 'Bearer secret-token' } })).status).toBe(400);
      expect((await fetch(`${base}/v1/events?after=nope`, { headers: { authorization: 'Bearer secret-token' } })).status).toBe(400);

      // Paging one at a time returns every event exactly once, even when changes share a timestamp.
      await db.query('UPDATE event_activity SET updated_at = $1', [ago(0.5)]);
      const seen: number[] = [];
      let url = `${base}/v1/events?limit=1`;
      for (let i = 0; i < 50; i++) {
        const page = (await (await fetch(url, { headers: { authorization: 'Bearer secret-token' } })).json()) as Json;
        seen.push(...page.events.map((e: { id: number }) => e.id));
        if (!page.more) break;
        url = `${base}/v1/events?limit=1&after=${encodeURIComponent(page.next)}`;
      }
      expect(seen.length).toBe(all.count);
      expect(new Set(seen).size).toBe(seen.length);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('runs mapr_retention()', async () => {
    await db.query(`UPDATE articles SET fetched_at = now() - interval '8 days' WHERE url = 'https://a.example/budget'`);
    await db.query('SELECT mapr_retention()');
    expect((await db.query(`SELECT count(*)::int AS n FROM articles WHERE url = 'https://a.example/budget'`)).rows[0].n).toBe(0);
    // The event and its citation outlive the article.
    expect((await db.query(`SELECT count(*)::int AS n FROM event_sources WHERE url = 'https://a.example/budget'`)).rows[0].n).toBe(1);
  });
});
