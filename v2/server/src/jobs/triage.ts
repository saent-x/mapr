// Triage jobs. The model call (Clef-flash, jobs/clef.ts) implements `Triager`
// and is registered in main.ts only when Workers AI credentials are set; until
// then triage jobs wait in the queue instead of being run by a stub and lost.

import type { Queryable } from '../db.js';
import type { JobHandler } from './runner.js';

export interface TriageSource {
  sourceId: number;
  source: string;
  url: string;
  title: string;
  publishedAt: Date | null;
  span: string | null;
}

export interface TriageEvent {
  id: number;
  title: string;
  summary: string | null;
  firstSeen: Date;
  lastSeen: Date;
  sourceCount: number;
  articleCount: number;
  /** Distinct-source count this job was enqueued for (1, 3 or 6). */
  milestone: number;
  sources: TriageSource[];
}

export interface Triager {
  /** Must record neurons spent (recordNeurons) and write results to the event. Throw to retry. */
  triageEvent(event: TriageEvent): Promise<void>;
}

export interface TriagePayload {
  event_id: number;
  n: number;
}

export async function loadTriageEvent(q: Queryable, eventId: number, milestone: number): Promise<TriageEvent | null> {
  const e = await q.query(
    `SELECT id, title, summary, first_seen, last_seen, source_count, article_count FROM events WHERE id = $1`,
    [eventId],
  );
  const row = e.rows[0];
  if (!row) return null;
  const s = await q.query(
    `SELECT es.source_id, s.name, es.url, es.title, es.published_at, es.span
     FROM event_sources es JOIN sources s ON s.id = es.source_id
     WHERE es.event_id = $1 ORDER BY es.published_at NULLS LAST, es.url`,
    [eventId],
  );
  return {
    id: Number(row.id),
    title: row.title,
    summary: row.summary,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    sourceCount: row.source_count,
    articleCount: row.article_count,
    milestone,
    sources: s.rows.map((r) => ({
      sourceId: r.source_id,
      source: r.name,
      url: r.url,
      title: r.title,
      publishedAt: r.published_at,
      span: r.span,
    })),
  };
}

export function triageHandlers(q: Queryable, triager: Triager, maxAgeHours = 48): JobHandler[] {
  const run: JobHandler['run'] = async (job) => {
    const p = job.payload as TriagePayload;
    const ev = await loadTriageEvent(q, Number(p.event_id), Number(p.n));
    if (!ev) return; // event expired or deleted: nothing left to triage
    // A job can wait days behind the budget gate; by then the event is past the triage window.
    if (Date.now() - new Date(ev.firstSeen).getTime() > maxAgeHours * 3_600_000) return;
    await triager.triageEvent(ev);
  };
  return [
    { kind: 'triage', ai: true, run },
    { kind: 're-triage', ai: true, run },
  ];
}
