// Pure clustering rules, kept apart from SQL so they are unit-testable.

export interface Candidate {
  eventId: number;
  /** Cosine similarity of the article vector to the event centroid. */
  similarity: number;
  lastSeen: Date;
}

export interface ClusterParams {
  threshold: number;
  windowHours: number;
}

export type Decision =
  | { action: 'join'; eventId: number; similarity: number }
  | { action: 'create'; reason: 'no-candidates' | 'below-threshold' | 'outside-window'; bestSimilarity: number | null };

/**
 * Join the most similar recent event whose centroid similarity is at least
 * `threshold` and whose last_seen is within `windowHours` of the article's
 * publication time (either direction, so late-arriving reports still join).
 * Otherwise a new event is created.
 */
export function decideCluster(candidates: readonly Candidate[], publishedAt: Date, p: ClusterParams): Decision {
  if (candidates.length === 0) return { action: 'create', reason: 'no-candidates', bestSimilarity: null };
  const sorted = [...candidates].sort((a, b) => b.similarity - a.similarity || a.eventId - b.eventId);
  const best = sorted[0]!.similarity;
  const windowMs = p.windowHours * 3_600_000;
  let sawSimilar = false;
  for (const c of sorted) {
    if (c.similarity < p.threshold) break;
    sawSimilar = true;
    if (Math.abs(publishedAt.getTime() - c.lastSeen.getTime()) <= windowMs) {
      return { action: 'join', eventId: c.eventId, similarity: c.similarity };
    }
  }
  return { action: 'create', reason: sawSimilar ? 'outside-window' : 'below-threshold', bestSimilarity: best };
}

/** Running mean of unit vectors, re-normalised: c' = norm(c * n + v). */
export function updateCentroid(centroid: readonly number[] | null, n: number, v: readonly number[]): number[] {
  if (!centroid || n <= 0) return normalizeVec(v);
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) out[i] = centroid[i]! * n + v[i]!;
  return normalizeVec(out);
}

export function normalizeVec(v: readonly number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  return n > 0 ? v.map((x) => x / n) : [...v];
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Distinct-source milestones that trigger a re-triage. */
export const RETRIAGE_AT = [3, 6] as const;

export function crossedMilestones(before: number, after: number): number[] {
  return RETRIAGE_AT.filter((m) => before < m && after >= m);
}
