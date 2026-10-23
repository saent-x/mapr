// Articles -> events. Runs over articles that have no event yet, in id order.
//
// Per article, in one transaction (idempotent: an article that already has an
// event is left alone, so a crashed or repeated run never double-counts):
//   near-duplicate of a clustered article (MinHash, last 72h) -> attach to its event
//   else embed (title + ". " + lead), nearest recent event centroid (HNSW)
//        -> join if similar and close in time, else create an event.

import { parseVector, toVector, withTx, type Db, type Queryable, type Tx } from '../db.js';
import type { Embedder } from '../embed/client.js';
import { embedText } from '../embed/client.js';
import type { Logger } from '../log.js';
import { bandKeys, similarity } from '../dedup/minhash.js';
import { enqueue, triageKey } from '../jobs/queue.js';
import { crossedMilestones, decideCluster, type Candidate, updateCentroid } from './decide.js';

export interface ClusterConfig {
  threshold: number;
  windowHours: number;
  lookbackDays: number;
  nearDupThreshold: number;
  embedBatch: number;
  /** Articles fetched longer ago than this are no longer clustered (default 72h). */
  pendingMaxAgeHours?: number;
  /** New events whose story is older than this are stored but not triaged (feed back-catalogue, not news). */
  triageMaxAgeHours?: number;
  candidates?: number;
}

export interface ClusterStats {
  created: number;
  joined: number;
  nearDup: number;
  skipped: number;
  failed: number;
}

interface PendingArticle {
  id: number;
  sourceId: number;
  url: string;
  title: string;
  lead: string | null;
  publishedAt: Date | null;
  fetchedAt: Date;
  minhash: number[] | null;
  embedding: number[] | null;
}

const CLUSTER_LOCK = 727002;

export const SPAN_CHARS = 300;

export function spanOf(lead: string | null): string | null {
  if (!lead) return null;
  const cps = Array.from(lead);
  return cps.length <= SPAN_CHARS ? lead : cps.slice(0, SPAN_CHARS).join('');
}

/** Story time of an article: its publication date, else when we fetched it; never in the future. */
function storyTime(a: PendingArticle, now = new Date()): Date {
  const t = a.publishedAt ?? a.fetchedAt;
  return t.getTime() > now.getTime() ? now : t;
}

async function loadPending(q: Queryable, limit: number, maxAgeHours: number, exclude: number[]): Promise<PendingArticle[]> {
  const r = await q.query(
    `SELECT id, source_id, url, title, lead, published_at, fetched_at, minhash, embedding::text AS embedding
     FROM articles
     WHERE event_id IS NULL AND fetched_at > now() - make_interval(hours => $2) AND NOT (id = ANY($3::bigint[]))
     ORDER BY id
     LIMIT $1`,
    [limit, maxAgeHours, exclude],
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    sourceId: x.source_id,
    url: x.url,
    title: x.title,
    lead: x.lead,
    publishedAt: x.published_at,
    fetchedAt: x.fetched_at,
    minhash: x.minhash,
    embedding: x.embedding ? parseVector(x.embedding) : null,
  }));
}

/** Best near-duplicate among already-clustered articles from the last 72h, if any. */
export async function findNearDup(
  q: Queryable,
  articleId: number,
  sig: number[],
  threshold: number,
): Promise<{ articleId: number; eventId: number; similarity: number } | null> {
  const r = await q.query<{ id: string; event_id: string; minhash: number[] }>(
    `SELECT a.id, a.event_id, a.minhash
     FROM articles a
     WHERE a.id IN (SELECT article_id FROM article_bands WHERE band_key = ANY($1::bigint[]))
       AND a.id <> $2 AND a.event_id IS NOT NULL AND a.minhash IS NOT NULL
       AND a.fetched_at > now() - interval '72 hours'`,
    [bandKeys(sig), articleId],
  );
  let best: { articleId: number; eventId: number; similarity: number } | null = null;
  for (const row of r.rows) {
    const s = similarity(sig, row.minhash);
    if (s >= threshold && (!best || s > best.similarity)) {
      best = { articleId: Number(row.id), eventId: Number(row.event_id), similarity: s };
    }
  }
  return best;
}

/** Lock the article; false if another run already gave it an event. */
async function lockUnclustered(tx: Tx, id: number): Promise<boolean> {
  const r = await tx.query<{ event_id: string | null }>('SELECT event_id FROM articles WHERE id = $1 FOR UPDATE', [id]);
  return r.rows.length === 1 && r.rows[0]!.event_id === null;
}

/**
 * Attach an article to an event: cite it, update counts, story time and
 * (when a vector is given) the centroid, and enqueue triage milestones.
 */
async function attach(tx: Tx, eventId: number, a: PendingArticle, vec: number[] | null, isNew: boolean, triage = true): Promise<void> {
  const ev = await tx.query<{ article_count: number; source_count: number; centroid: string | null }>(
    `SELECT article_count, source_count, ${vec ? 'centroid::text AS centroid' : 'NULL AS centroid'} FROM events WHERE id = $1 FOR UPDATE`,
    [eventId],
  );
  const cur = ev.rows[0];
  if (!cur) throw new Error(`event ${eventId} vanished`);

  await tx.query(
    `INSERT INTO event_sources (event_id, source_id, url, title, published_at, span)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (event_id, url) DO NOTHING`,
    [eventId, a.sourceId, a.url, a.title, a.publishedAt, spanOf(a.lead)],
  );
  await tx.query('UPDATE articles SET event_id = $2 WHERE id = $1', [a.id, eventId]);
  const sc = await tx.query<{ n: number }>(
    'SELECT count(DISTINCT source_id)::int AS n FROM event_sources WHERE event_id = $1',
    [eventId],
  );
  const sourceCount = sc.rows[0]!.n;
  const t = storyTime(a);

  let centroid: string | null = null;
  if (vec) {
    const old = cur.centroid ? parseVector(cur.centroid) : null;
    centroid = toVector(updateCentroid(old, old ? cur.article_count : 0, vec));
  }
  await tx.query(
    `UPDATE events SET
       article_count = article_count + 1,
       source_count = $2,
       first_seen = LEAST(first_seen, $3),
       last_seen = GREATEST(last_seen, $3),
       centroid = COALESCE($4::vector, centroid)
     WHERE id = $1`,
    [eventId, sourceCount, t, centroid],
  );
  await tx.query(
    `INSERT INTO event_activity (event_id, updated_at) VALUES ($1, now())
     ON CONFLICT (event_id) DO UPDATE SET updated_at = now()`,
    [eventId],
  );

  if (isNew) {
    if (!triage) return;
    await enqueue(tx, 'triage', { event_id: eventId, n: 1 }, triageKey(eventId, 1));
  } else {
    for (const m of crossedMilestones(cur.source_count, sourceCount)) {
      await enqueue(tx, 're-triage', { event_id: eventId, n: m }, triageKey(eventId, m));
    }
  }
}

export async function nearestEvents(tx: Queryable, vec: number[], lookbackDays: number, k: number): Promise<Candidate[]> {
  const r = await tx.query<{ id: string; sim: number; last_seen: Date }>(
    `SELECT id, 1 - (centroid <=> $1::vector) AS sim, last_seen
     FROM events
     WHERE centroid IS NOT NULL AND last_seen > now() - make_interval(days => $2)
     ORDER BY centroid <=> $1::vector
     LIMIT $3`,
    [toVector(vec), lookbackDays, k],
  );
  return r.rows.map((x) => ({ eventId: Number(x.id), similarity: Number(x.sim), lastSeen: x.last_seen }));
}

async function clusterOne(db: Db, a: PendingArticle, vec: number[], cfg: ClusterConfig): Promise<'joined' | 'created' | 'skipped'> {
  return withTx(db, async (tx) => {
    if (!(await lockUnclustered(tx, a.id))) return 'skipped';
    // pgvector >= 0.8: keep scanning the HNSW index until the WHERE filter is satisfied.
    await tx.query(`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`);
    await tx.query(`SET LOCAL hnsw.ef_search = 100`);
    // Serialise centroid updates across concurrent writers.
    await tx.query('SELECT pg_advisory_xact_lock($1)', [CLUSTER_LOCK]);
    const cands = await nearestEvents(tx, vec, cfg.lookbackDays, cfg.candidates ?? 5);
    const d = decideCluster(cands, storyTime(a), { threshold: cfg.threshold, windowHours: cfg.windowHours });
    if (d.action === 'join') {
      await attach(tx, d.eventId, a, vec, false);
      return 'joined';
    }
    const t = storyTime(a);
    const ins = await tx.query<{ id: string }>(
      `INSERT INTO events (title, first_seen, last_seen, article_count, source_count)
       VALUES ($1, $2, $2, 0, 0) RETURNING id`,
      [a.title, t],
    );
    const fresh = t.getTime() >= Date.now() - (cfg.triageMaxAgeHours ?? 48) * 3_600_000;
    await attach(tx, Number(ins.rows[0]!.id), a, vec, true, fresh);
    return 'created';
  });
}

async function attachDup(db: Db, a: PendingArticle, eventId: number): Promise<boolean> {
  return withTx(db, async (tx) => {
    if (!(await lockUnclustered(tx, a.id))) return false;
    await tx.query('SELECT pg_advisory_xact_lock($1)', [CLUSTER_LOCK]);
    await attach(tx, eventId, a, null, false);
    return true;
  });
}

export interface ClusterDeps {
  db: Db;
  embedder: Embedder;
  cfg: ClusterConfig;
  log: Logger;
  signal?: AbortSignal;
}

/** Cluster every pending article. Safe to call concurrently and repeatedly. */
export async function clusterPending(deps: ClusterDeps): Promise<ClusterStats> {
  const { db, embedder, cfg, log, signal } = deps;
  const stats: ClusterStats = { created: 0, joined: 0, nearDup: 0, skipped: 0, failed: 0 };
  const failedIds: number[] = [];
  const batch = cfg.embedBatch;
  const maxAge = cfg.pendingMaxAgeHours ?? 72;

  while (!signal?.aborted) {
    const pending = await loadPending(db, batch, maxAge, failedIds);
    if (pending.length === 0) break;

    // 1. Near-duplicates: against clustered articles in the DB, then against earlier articles in this batch.
    const leaders: PendingArticle[] = [];
    const followers = new Map<number, PendingArticle[]>(); // leader id -> near-dups waiting for its event
    for (const a of pending) {
      if (a.minhash) {
        try {
          const dup = await findNearDup(db, a.id, a.minhash, cfg.nearDupThreshold);
          if (dup) {
            if (await attachDup(db, a, dup.eventId)) stats.nearDup++;
            else stats.skipped++;
            continue;
          }
        } catch (err) {
          stats.failed++;
          failedIds.push(a.id);
          log.error('near-duplicate attach failed for article', { article_id: a.id, err });
          continue;
        }
        const leader = leaders.find((l) => l.minhash && similarity(l.minhash, a.minhash!) >= cfg.nearDupThreshold);
        if (leader) {
          followers.set(leader.id, [...(followers.get(leader.id) ?? []), a]);
          continue;
        }
      }
      leaders.push(a);
    }

    // 2. Embed what has no vector yet. If the embedder is down, stop: articles stay pending.
    const need = leaders.filter((a) => !a.embedding);
    if (need.length) {
      let vecs: number[][];
      try {
        vecs = await embedder.embed(need.map((a) => embedText(a.title, a.lead)), signal);
      } catch (err) {
        log.warn('embedding failed; articles stay pending', { err, articles: need.length });
        break;
      }
      for (let i = 0; i < need.length; i++) {
        need[i]!.embedding = vecs[i]!;
        await db.query('UPDATE articles SET embedding = $2::vector WHERE id = $1', [need[i]!.id, toVector(vecs[i]!)]);
      }
    }

    // 3. Cluster leaders in order, then attach their in-batch near-duplicates.
    for (const a of leaders) {
      try {
        const outcome = await clusterOne(db, a, a.embedding!, cfg);
        stats[outcome === 'joined' ? 'joined' : outcome === 'created' ? 'created' : 'skipped']++;
        const ev = await db.query<{ event_id: string | null }>('SELECT event_id FROM articles WHERE id = $1', [a.id]);
        const eventId = ev.rows[0]?.event_id;
        for (const f of followers.get(a.id) ?? []) {
          if (eventId && (await attachDup(db, f, Number(eventId)))) stats.nearDup++;
        }
      } catch (err) {
        stats.failed++;
        failedIds.push(a.id, ...(followers.get(a.id) ?? []).map((f) => f.id));
        log.error('clustering failed for article', { article_id: a.id, err });
      }
    }
  }
  if (stats.created + stats.joined + stats.nearDup + stats.failed > 0) log.info('clustered', { ...stats });
  return stats;
}
