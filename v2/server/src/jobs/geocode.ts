// Geocode jobs: one per new event, again when more outlets join (more text to go on).
// Local and free (embedder /geocode), so they are not AI jobs and run while the budget is closed.

import type { Queryable } from '../db.js';
import type { GeoInput, Geocoder } from '../geo/client.js';
import { enqueue, MAX_ATTEMPTS } from './queue.js';
import type { JobHandler } from './runner.js';

/** Above triage (whose priority is the source count): a desk event should arrive with its place. */
export const GEOCODE_PRIORITY = 100;
const MAX_TITLES = 8;
const MAX_SPANS = 6;

export const geocodeKey = (eventId: number, n: number): string => `geo:${eventId}:${n}`;

export async function enqueueGeocode(q: Queryable, eventId: number, n: number): Promise<void> {
  await enqueue(q, 'geocode', { event_id: eventId, n }, geocodeKey(eventId, n), undefined, GEOCODE_PRIORITY);
}

/** The event's title counts most, then each outlet's headline, then the opening lines. */
export async function loadGeoInput(q: Queryable, eventId: number): Promise<GeoInput | null> {
  const e = await q.query<{ title: string; summary: string | null }>('SELECT title, summary FROM events WHERE id = $1', [eventId]);
  const ev = e.rows[0];
  if (!ev) return null;
  const s = await q.query<{ title: string; span: string | null; region: string | null }>(
    `SELECT es.title, es.span, s.region
     FROM event_sources es JOIN sources s ON s.id = es.source_id
     WHERE es.event_id = $1 ORDER BY es.published_at NULLS LAST, es.url LIMIT 32`,
    [eventId],
  );
  const texts = [{ text: ev.title, weight: 3 }];
  if (ev.summary) texts.push({ text: ev.summary, weight: 1 });
  const seen = new Set([ev.title]);
  for (const r of s.rows) {
    if (texts.length - 1 >= MAX_TITLES) break;
    if (!seen.has(r.title)) texts.push({ text: r.title, weight: 1 }), seen.add(r.title);
  }
  let spans = 0;
  for (const r of s.rows) {
    if (spans >= MAX_SPANS) break;
    if (r.span && !seen.has(r.span)) texts.push({ text: r.span, weight: 0.5 }), seen.add(r.span), spans++;
  }
  // sources.region is an ISO code for national outlets, a word (GLOBAL, MENA, ...) for the rest.
  const countries = [...new Set(s.rows.map((r) => r.region).filter((c): c is string => !!c && /^[A-Z]{2}$/.test(c) && c !== 'EU'))];
  return { texts: texts.filter((t) => t.text.trim()), sourceCountries: countries };
}

export function geocodeHandler(q: Queryable, geocoder: Geocoder): JobHandler {
  return {
    kind: 'geocode',
    ai: false,
    async run(job, signal) {
      const id = Number((job.payload as { event_id: number }).event_id);
      const input = await loadGeoInput(q, id);
      if (!input) return; // event expired
      const [g] = await geocoder.geocode([input], signal);
      const r = await q.query(
        `UPDATE events SET place = $2, country = $3, lat = $4, lon = $5, geo_precision = $6, geo_conf = $7, geocoded_at = now()
         WHERE id = $1
           AND (place, country, lat, lon, geo_precision) IS DISTINCT FROM ($2::text, $3::char(2), $4::float8, $5::float8, $6::text)
         RETURNING id`,
        [id, g!.place, g!.country, g!.lat, g!.lon, g!.precision, g!.confidence],
      );
      if (r.rowCount) {
        // Changed: tell the Worker (its cursor follows event_activity).
        await q.query(
          `INSERT INTO event_activity (event_id, updated_at) VALUES ($1, now())
           ON CONFLICT (event_id) DO UPDATE SET updated_at = now()`,
          [id],
        );
      } else {
        await q.query('UPDATE events SET geocoded_at = now() WHERE id = $1', [id]);
      }
    },
  };
}

/**
 * Queue recent events that were never placed (events from before geocoding existed, or whose
 * job died while the embedder was down). Dead jobs are cleared first so their keys can be reused.
 */
export async function backfillGeocode(q: Queryable, hours = 72): Promise<number> {
  await q.query(`DELETE FROM jobs WHERE kind = 'geocode' AND attempts >= $1 AND locked_at IS NULL`, [MAX_ATTEMPTS]);
  const r = await q.query(
    `INSERT INTO jobs (kind, payload, dedupe_key, priority)
     SELECT 'geocode', jsonb_build_object('event_id', e.id, 'n', 1), 'geo:' || e.id || ':1',
            CASE WHEN e.relevant THEN $2 + 10 ELSE $2 END -- what the desk shows goes first
     FROM events e
     WHERE e.geocoded_at IS NULL AND e.last_seen > now() - make_interval(hours => $1)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [hours, GEOCODE_PRIORITY],
  );
  return r.rowCount ?? 0;
}
