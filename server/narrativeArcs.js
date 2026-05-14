/**
 * server/narrativeArcs.js — auto-discover multi-event narrative arcs.
 *
 * Every refresh sweep:
 *   1. Pull active events from the last 30 days.
 *   2. Compute a per-event centroid by averaging the event's articles'
 *      embeddings.
 *   3. Greedy-cluster events into arcs (cosine ≥ 0.65 AND ≥1 shared
 *      entity name).
 *   4. Keep clusters with ≥5 events spanning ≥7 days.
 *   5. For each kept cluster, name it via the LLM with the
 *      narrativeArc.schema.json shape.
 *   6. Persist; for existing arcs that overlap, merge new events in
 *      rather than duplicating.
 */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureDatabase, readActiveEvents, readEventArticlesBatch } from './storage.js';
import { generate as aiGenerate } from './ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARC_SCHEMA = JSON.parse(readFileSync(path.join(__dirname, 'ai', 'schemas', 'narrativeArc.schema.json'), 'utf8'));

const SWEEP_WINDOW_HOURS = 30 * 24;
const SIMILARITY_THRESHOLD = 0.65;
const MIN_CLUSTER_EVENTS = 5;
const MIN_SPAN_MS = 7 * 24 * 3600 * 1000;
const MAX_CLUSTERS_PER_SWEEP = 12;

function nowIso() { return new Date().toISOString(); }

function newArcId() {
  return 'arc_' + crypto.randomBytes(9).toString('base64url');
}

function clamp(s, n) { return String(s || '').slice(0, n); }

// ── vector helpers ───────────────────────────────────────────────────

function parseVectorLiteral(literal) {
  if (!literal) return null;
  if (Array.isArray(literal)) return literal.map(Number);
  const s = String(literal).trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return null;
  return s.slice(1, -1).split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));
}

function dot(a, b) {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) s += a[i] * b[i];
  return s;
}

function norm(v) {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  const denom = norm(a) * norm(b);
  if (denom === 0) return 0;
  return dot(a, b) / denom;
}

function average(vectors) {
  if (!vectors.length) return null;
  const out = new Array(vectors[0].length).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < out.length; i += 1) out[i] += v[i];
  }
  for (let i = 0; i < out.length; i += 1) out[i] /= vectors.length;
  return out;
}

// ── event/centroid computation ───────────────────────────────────────

function eventEntityKeys(event) {
  const set = new Set();
  const ents = event.entities || {};
  for (const kind of ['people', 'organizations', 'locations']) {
    for (const item of (ents[kind] || [])) {
      const n = typeof item === 'string' ? item : item?.name;
      if (n) set.add(String(n).toLowerCase());
    }
  }
  return set;
}

function articleEmbeddingsForEvent(articlesByEvent, eventId) {
  const articles = articlesByEvent.get(eventId) || [];
  const vectors = [];
  for (const a of articles) {
    let payload = {};
    try { payload = a.payload ? JSON.parse(a.payload) : {}; } catch {}
    // The embedding might be on the article row directly (vector type
    // serialized via libpq) OR inside the payload depending on path.
    const candidate = a.embedding || payload.embedding;
    const v = parseVectorLiteral(candidate);
    if (v && v.length) vectors.push(v);
  }
  return vectors;
}

async function loadEventEmbeddings(events) {
  if (!events.length) return new Map();
  const db = await ensureDatabase();
  const ids = events.map((e) => e.id);
  // Pull the article embeddings for each event in one query.
  const { rows } = await db.query(
    `SELECT ea."eventId", a.embedding::text AS embedding
       FROM event_articles ea
       JOIN articles a ON a.id = ea."articleId"
      WHERE ea."eventId" = ANY($1) AND a.embedding IS NOT NULL`,
    [ids],
  );
  const byEvent = new Map();
  for (const row of rows) {
    const v = parseVectorLiteral(row.embedding);
    if (!v) continue;
    if (!byEvent.has(row.eventId)) byEvent.set(row.eventId, []);
    byEvent.get(row.eventId).push(v);
  }
  const centroids = new Map();
  for (const [eid, vecs] of byEvent) {
    const c = average(vecs);
    if (c) centroids.set(eid, c);
  }
  return centroids;
}

// ── greedy clustering ────────────────────────────────────────────────

function clusterEvents(events, centroids) {
  const clusters = [];
  for (const ev of events) {
    const eventCentroid = centroids.get(ev.id);
    if (!eventCentroid) continue;
    const entities = eventEntityKeys(ev);
    let placed = false;
    for (const cluster of clusters) {
      // Must share at least one entity with someone already in the cluster.
      const overlap = [...entities].some((e) => cluster.entityUnion.has(e));
      if (!overlap) continue;
      const sim = cosine(eventCentroid, cluster.centroid);
      if (sim < SIMILARITY_THRESHOLD) continue;
      cluster.events.push({ event: ev, similarity: sim });
      // Update the cluster centroid as the running average.
      const n = cluster.events.length;
      for (let i = 0; i < cluster.centroid.length; i += 1) {
        cluster.centroid[i] = (cluster.centroid[i] * (n - 1) + eventCentroid[i]) / n;
      }
      for (const e of entities) cluster.entityUnion.add(e);
      placed = true;
      break;
    }
    if (!placed) {
      clusters.push({
        centroid: eventCentroid.slice(),
        entityUnion: new Set(entities),
        events: [{ event: ev, similarity: 1 }],
      });
    }
  }
  return clusters;
}

function filterDurableClusters(clusters) {
  return clusters.filter((c) => {
    if (c.events.length < MIN_CLUSTER_EVENTS) return false;
    const times = c.events
      .map(({ event }) => new Date(event.firstSeenAt || event.lastUpdatedAt || 0).getTime())
      .filter((t) => Number.isFinite(t));
    if (!times.length) return false;
    const span = Math.max(...times) - Math.min(...times);
    return span >= MIN_SPAN_MS;
  });
}

// ── LLM naming ───────────────────────────────────────────────────────

function buildLlmInput(cluster) {
  const events = cluster.events
    .slice()
    .sort((a, b) => (b.event.severity || 0) - (a.event.severity || 0))
    .slice(0, 6);
  const entityFreq = new Map();
  for (const { event } of cluster.events) {
    for (const key of eventEntityKeys(event)) {
      entityFreq.set(key, (entityFreq.get(key) || 0) + 1);
    }
  }
  const topEntities = [...entityFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }));
  return {
    cluster: {
      eventCount: cluster.events.length,
      sampleTitles: events.map(({ event }) => clamp(event.title, 200)),
      regions: [...new Set(cluster.events.map(({ event }) => event.primaryCountry || event.isoA2).filter(Boolean))].slice(0, 6),
      topEntities,
      lifecycle: [...new Set(cluster.events.map(({ event }) => event.lifecycle).filter(Boolean))],
    },
    instructions: [
      'Pick a short, sentence-cased name for this narrative arc.',
      'Include a region/topic + a rough time span when natural.',
      'Write a 2-4 sentence neutral summary based ONLY on the provided titles and entities.',
      'Choose status: active when activity is ongoing, dormant when quiet for >2 weeks, resolved when explicitly concluded.',
      'Pick up to 6 short topical tags useful for filtering.',
    ].join(' '),
  };
}

async function nameCluster(cluster) {
  try {
    const result = await aiGenerate({
      task: 'narrative_arc_name',
      input: buildLlmInput(cluster),
      schema: ARC_SCHEMA,
      maxTokens: 512,
      temperature: 0.3,
    });
    const out = result?.output || {};
    return {
      name: clamp(out.name, 120) || 'Untitled arc',
      summary: clamp(out.summary, 600) || '',
      status: ['active', 'dormant', 'resolved'].includes(out.status) ? out.status : 'active',
      tags: Array.isArray(out.tags) ? out.tags.slice(0, 6) : [],
      modelUsed: result?.model || 'unknown',
    };
  } catch (err) {
    if (err?.code === 'AI_HOMEPC_NOT_CONFIGURED' || err?.code === 'AI_WORKERSAI_NOT_CONFIGURED') {
      throw err;
    }
    return null;
  }
}

// ── persistence ──────────────────────────────────────────────────────

async function persistArc(named, cluster) {
  const db = await ensureDatabase();
  const ts = nowIso();
  // Look for an overlap with an existing active arc: an arc that already
  // contains ≥3 of this cluster's events. If found, append; else create.
  const eventIds = cluster.events.map(({ event }) => event.id);
  const { rows: existing } = await db.query(
    `SELECT a.id, a."eventCount", a.name, a."firstSeenAt"
       FROM narrative_arcs a
       JOIN narrative_arc_events ae ON ae."arcId" = a.id
      WHERE a.status != 'archived' AND ae."eventId" = ANY($1)
      GROUP BY a.id, a."eventCount", a.name, a."firstSeenAt"
      HAVING count(ae."eventId") >= 3
      ORDER BY count(ae."eventId") DESC
      LIMIT 1`,
    [eventIds],
  );

  let arcId;
  if (existing[0]) {
    arcId = existing[0].id;
    await db.query(
      `UPDATE narrative_arcs SET
         "lastUpdatedAt" = $1,
         status = $2,
         "modelUsed" = $3
       WHERE id = $4`,
      [ts, named.status, named.modelUsed, arcId],
    );
  } else {
    arcId = newArcId();
    const earliest = cluster.events
      .map(({ event }) => event.firstSeenAt || event.lastUpdatedAt || ts)
      .sort()[0];
    await db.query(
      `INSERT INTO narrative_arcs (id, name, summary, status, "firstSeenAt", "lastUpdatedAt", "eventCount", "modelUsed")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [arcId, named.name, named.summary, named.status, earliest, ts, 0, named.modelUsed],
    );
  }

  // Append events not yet linked.
  const values = [];
  const params = [];
  let idx = 1;
  for (const { event, similarity } of cluster.events) {
    values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
    params.push(arcId, event.id, ts, similarity);
    idx += 4;
  }
  await db.query(
    `INSERT INTO narrative_arc_events ("arcId", "eventId", "addedAt", relevance)
       VALUES ${values.join(',')}
       ON CONFLICT ("arcId", "eventId") DO UPDATE SET
         relevance = EXCLUDED.relevance`,
    params,
  );
  const { rows: countRow } = await db.query(
    `SELECT count(*)::int AS n FROM narrative_arc_events WHERE "arcId" = $1`,
    [arcId],
  );
  await db.query(
    `UPDATE narrative_arcs SET "eventCount" = $1 WHERE id = $2`,
    [countRow[0]?.n || cluster.events.length, arcId],
  );
  return arcId;
}

// ── public sweep + reads ─────────────────────────────────────────────

export async function runNarrativeArcSweep({ dryRun = false } = {}) {
  const events = await readActiveEvents({ maxAgeHours: SWEEP_WINDOW_HOURS });
  if (events.length < MIN_CLUSTER_EVENTS) {
    return { skipped: true, reason: 'NOT_ENOUGH_EVENTS', eventCount: events.length };
  }
  const centroids = await loadEventEmbeddings(events);
  if (!centroids.size) {
    return { skipped: true, reason: 'NO_EMBEDDINGS' };
  }
  const clusters = filterDurableClusters(clusterEvents(events, centroids))
    .slice(0, MAX_CLUSTERS_PER_SWEEP);
  if (!clusters.length) {
    return { skipped: true, reason: 'NO_DURABLE_CLUSTERS', clusters: 0 };
  }
  if (dryRun) {
    return {
      dryRun: true,
      clusters: clusters.length,
      summary: clusters.map((c) => ({
        eventCount: c.events.length,
        sample: c.events.slice(0, 3).map(({ event }) => event.title),
        topEntities: [...c.entityUnion].slice(0, 6),
      })),
    };
  }
  const results = [];
  for (const cluster of clusters) {
    try {
      const named = await nameCluster(cluster);
      if (!named) {
        results.push({ skipped: true, reason: 'NAME_FAILED', eventCount: cluster.events.length });
        continue;
      }
      const arcId = await persistArc(named, cluster);
      results.push({ arcId, name: named.name, eventCount: cluster.events.length });
    } catch (err) {
      if (err?.code === 'AI_HOMEPC_NOT_CONFIGURED' || err?.code === 'AI_WORKERSAI_NOT_CONFIGURED') {
        return { skipped: true, reason: 'AI_NOT_CONFIGURED', completed: results.length };
      }
      results.push({ error: err.message });
    }
  }
  return { sweptAt: nowIso(), processed: results.length, results };
}

export async function listActiveArcs({ limit = 24, status = 'active' } = {}) {
  const db = await ensureDatabase();
  const { rows } = await db.query(
    `SELECT id, name, summary, status, "firstSeenAt", "lastUpdatedAt", "eventCount"
       FROM narrative_arcs
      WHERE status = $1
      ORDER BY "lastUpdatedAt" DESC
      LIMIT $2`,
    [status, limit],
  );
  return rows;
}

export async function readArc(arcId) {
  if (!arcId) return null;
  const db = await ensureDatabase();
  const { rows: arcRows } = await db.query(
    `SELECT * FROM narrative_arcs WHERE id = $1`,
    [arcId],
  );
  if (!arcRows[0]) return null;
  const { rows: eventRows } = await db.query(
    `SELECT ae."eventId", ae.relevance, ae."addedAt",
            e.title, e.severity, e.lifecycle, e."primaryCountry", e."isoA2",
            e."firstSeenAt", e."lastUpdatedAt"
       FROM narrative_arc_events ae
       JOIN events e ON e.id = ae."eventId"
      WHERE ae."arcId" = $1
      ORDER BY e."lastUpdatedAt" DESC
      LIMIT 50`,
    [arcId],
  );
  return { ...arcRows[0], events: eventRows };
}

export async function readArcsForEvent(eventId) {
  if (!eventId) return [];
  const db = await ensureDatabase();
  const { rows } = await db.query(
    `SELECT a.id, a.name, a.status, a."lastUpdatedAt"
       FROM narrative_arc_events ae
       JOIN narrative_arcs a ON a.id = ae."arcId"
      WHERE ae."eventId" = $1
      ORDER BY a."lastUpdatedAt" DESC`,
    [eventId],
  );
  return rows;
}

export const __test__ = {
  parseVectorLiteral, cosine, average, eventEntityKeys,
  filterDurableClusters, clusterEvents,
};
