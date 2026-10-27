import type { Queryable } from '../db.js';

export const MAX_ATTEMPTS = 8;

/** Insert a job unless one with the same dedupe key exists. Returns the new id, or null if deduped. */
export async function enqueue(
  q: Queryable,
  kind: string,
  payload: unknown,
  dedupeKey: string | null,
  runAfter?: Date,
): Promise<number | null> {
  const r = await q.query<{ id: string }>(
    `INSERT INTO jobs (kind, payload, dedupe_key, run_after)
     VALUES ($1, $2, $3, COALESCE($4, now()))
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [kind, JSON.stringify(payload), dedupeKey, runAfter ?? null],
  );
  return r.rows[0] ? Number(r.rows[0].id) : null;
}

/** Exponential backoff: base * 2^(attempt-1), capped. `attempt` counts from 1. */
export function backoffMs(attempt: number, baseMs = 30_000, maxMs = 6 * 3_600_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

export const triageKey = (eventId: number, n: number): string => `triage:${eventId}:${n}`;
