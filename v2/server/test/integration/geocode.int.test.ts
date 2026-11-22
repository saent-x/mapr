// Geocode jobs against a real ParadeDB: queued with new events, results written once, Worker told only on change.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, createPool, type Db } from '../../src/db.js';
import type { GeoInput, GeoResult, Geocoder } from '../../src/geo/client.js';
import { backfillGeocode, enqueueGeocode, GEOCODE_PRIORITY, geocodeHandler, loadGeoInput } from '../../src/jobs/geocode.js';
import { BudgetGate } from '../../src/jobs/budget.js';
import { MAX_ATTEMPTS } from '../../src/jobs/queue.js';
import { JobRunner } from '../../src/jobs/runner.js';
import { log as rootLog, setLogLevel } from '../../src/log.js';
import { seedSources } from '../../src/seed.js';
import { dockerAvailable, MIGRATIONS_DIR, startDb, type TestDb } from '../helpers/pg.js';

const HAVE_DB = dockerAvailable();

class FakeGeocoder implements Geocoder {
  calls: GeoInput[] = [];
  result: GeoResult = { place: 'Kharkiv', country: 'UA', lat: 49.98, lon: 36.25, precision: 'city', confidence: 0.9 };
  fail = false;
  async geocode(events: GeoInput[]): Promise<GeoResult[]> {
    if (this.fail) throw new Error('geocoder HTTP 503: geocoder not loaded');
    this.calls.push(...events);
    return events.map(() => this.result);
  }
}

describe.skipIf(!HAVE_DB)('geocode jobs against ParadeDB', () => {
  let tdb: TestDb;
  let db: Db;
  const log = rootLog.child({ test: 'geo' });

  beforeAll(async () => {
    setLogLevel('error');
    tdb = await startDb();
    db = createPool(tdb.url, 4);
    expect(await applyMigrations(db, MIGRATIONS_DIR)).toContain('0004_geocode.sql');
    await seedSources(db, [
      { name: 'Kyiv Independent', url: 'https://ua.example/rss', kind: 'rss', region: 'UA' },
      { name: 'Wire', url: 'https://w.example/rss', kind: 'rss', region: 'GLOBAL' },
      { name: 'EU desk', url: 'https://eu.example/rss', kind: 'rss', region: 'EU' },
    ]);
  });

  afterAll(async () => {
    await db?.end();
    await tdb?.stop();
  });

  async function event(title: string, sources: Array<[string, string, string | null]>, lastSeenHoursAgo = 1): Promise<number> {
    const e = await db.query<{ id: string }>(
      `INSERT INTO events (title, first_seen, last_seen, source_count, article_count)
       VALUES ($1, now() - make_interval(hours => $2), now() - make_interval(hours => $2), $3, $3) RETURNING id`,
      [title, lastSeenHoursAgo, sources.length],
    );
    const id = Number(e.rows[0]!.id);
    for (const [src, t, span] of sources) {
      await db.query(
        `INSERT INTO event_sources (event_id, source_id, url, title, published_at, span)
         SELECT $1, id, $2, $3, now(), $4 FROM sources WHERE name = $5`,
        [id, `https://x.example/${id}/${src}`, t, span, src],
      );
    }
    return id;
  }

  const runner = (g: Geocoder) => {
    const r = new JobRunner(db, { budget: new BudgetGate(db, 9000), log, baseBackoffMs: 1 });
    r.register(geocodeHandler(db, g));
    return r;
  };

  it('builds weighted texts and ISO outlet countries', async () => {
    const id = await event('Strike on Kharkiv', [
      ['Kyiv Independent', 'Strike on Kharkiv', 'Russian missiles hit Kharkiv overnight.'],
      ['Wire', 'Missile attack hits Ukrainian city', null],
      ['EU desk', 'Kharkiv struck again', 'Officials in Kharkiv said...'],
    ]);
    const input = (await loadGeoInput(db, id))!;
    expect(input.texts).toEqual([
      { text: 'Strike on Kharkiv', weight: 3 },
      { text: 'Missile attack hits Ukrainian city', weight: 1 },
      { text: 'Kharkiv struck again', weight: 1 },
      { text: 'Russian missiles hit Kharkiv overnight.', weight: 0.5 },
      { text: 'Officials in Kharkiv said...', weight: 0.5 },
    ]);
    expect(input.sourceCountries).toEqual(['UA']); // GLOBAL and EU are not countries
  });

  it('writes the place once and bumps event_activity only when it changes', async () => {
    const id = await event('Blast in Kharkiv', [['Wire', 'Blast in Kharkiv', null]]);
    const g = new FakeGeocoder();
    const r = runner(g);
    await enqueueGeocode(db, id, 1);
    const prio = await db.query(`SELECT priority FROM jobs WHERE dedupe_key = $1`, [`geo:${id}:1`]);
    expect(prio.rows[0].priority).toBe(GEOCODE_PRIORITY);
    expect(await r.runOnce()).toBe('done');
    const row = (await db.query(`SELECT place, country, lat, lon, geo_precision, geo_conf, geocoded_at FROM events WHERE id = $1`, [id])).rows[0];
    expect(row).toMatchObject({ place: 'Kharkiv', country: 'UA', lat: 49.98, lon: 36.25, geo_precision: 'city' });
    expect(row.geo_conf).toBeCloseTo(0.9);
    const a1 = (await db.query(`SELECT updated_at FROM event_activity WHERE event_id = $1`, [id])).rows[0].updated_at;

    await enqueueGeocode(db, id, 3); // same answer: no activity bump
    expect(await r.runOnce()).toBe('done');
    const a2 = (await db.query(`SELECT updated_at FROM event_activity WHERE event_id = $1`, [id])).rows[0].updated_at;
    expect(a2.getTime()).toBe(a1.getTime());

    g.result = { place: null, country: null, lat: null, lon: null, precision: null, confidence: 0 };
    await enqueueGeocode(db, id, 6);
    expect(await r.runOnce()).toBe('done');
    const a3 = (await db.query(`SELECT updated_at FROM event_activity WHERE event_id = $1`, [id])).rows[0].updated_at;
    expect(a3.getTime()).toBeGreaterThan(a1.getTime());
  });

  it('runs while the AI budget is closed', async () => {
    await db.query(`INSERT INTO ai_usage (day, mapr_neurons) VALUES ((now() AT TIME ZONE 'UTC')::date, 99999)
                    ON CONFLICT (day) DO UPDATE SET mapr_neurons = 99999`);
    const id = await event('Flood in Kharkiv', [['Wire', 'Flood in Kharkiv', null]]);
    await enqueueGeocode(db, id, 1);
    expect(await runner(new FakeGeocoder()).runOnce()).toBe('done');
    await db.query(`UPDATE ai_usage SET mapr_neurons = 0`);
  });

  it('backfills recent unplaced events, relevant first, and revives dead jobs', async () => {
    await db.query(`DELETE FROM jobs`);
    const recent = await event('Old news A', [['Wire', 'Old news A', null]], 10);
    const relevant = await event('Old news B', [['Wire', 'Old news B', null]], 20);
    await db.query(`UPDATE events SET relevant = true WHERE id = $1`, [relevant]);
    const stale = await event('Old news C', [['Wire', 'Old news C', null]], 100);
    const dead = await event('Old news D', [['Wire', 'Old news D', null]], 5);
    await db.query(`INSERT INTO jobs (kind, payload, dedupe_key, attempts, priority) VALUES ('geocode', $1, $2, $3, 100)`, [
      JSON.stringify({ event_id: dead, n: 1 }),
      `geo:${dead}:1`,
      MAX_ATTEMPTS,
    ]);
    const n = await backfillGeocode(db, 72);
    const jobs = await db.query(`SELECT (payload->>'event_id')::int AS id, priority, attempts FROM jobs ORDER BY priority DESC, id`);
    const ids = jobs.rows.map((j) => j.id);
    expect(ids).toContain(recent);
    expect(ids).toContain(dead);
    expect(ids).not.toContain(stale);
    expect(jobs.rows[0]).toMatchObject({ id: relevant, priority: GEOCODE_PRIORITY + 10 });
    expect(jobs.rows.every((j) => j.attempts === 0)).toBe(true);
    expect(n).toBe(jobs.rows.length);
    expect(await backfillGeocode(db, 72)).toBe(0); // idempotent while queued
  });

  it('retries when the geocoder is not ready', async () => {
    await db.query(`DELETE FROM jobs`);
    const id = await event('Fire in Kharkiv', [['Wire', 'Fire in Kharkiv', null]]);
    await enqueueGeocode(db, id, 1);
    const g = new FakeGeocoder();
    g.fail = true;
    expect(await runner(g).runOnce()).toBe('retry');
    const j = (await db.query(`SELECT attempts, last_error FROM jobs`)).rows[0];
    expect(j.attempts).toBe(1);
    expect(j.last_error).toContain('503');
  });
});
