import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import { sleep } from '../util/pool.js';
import type { BudgetGate } from './budget.js';
import { backoffMs, MAX_ATTEMPTS } from './queue.js';

export interface Job {
  id: number;
  kind: string;
  payload: unknown;
  attempts: number;
}

export interface JobHandler {
  kind: string;
  /** AI jobs pass through the budget gate first. */
  ai: boolean;
  run(job: Job, signal: AbortSignal): Promise<void>;
}

export interface RunnerOptions {
  budget: BudgetGate;
  log: Logger;
  pollMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  staleLockMs?: number;
}

export type RunOutcome = 'idle' | 'done' | 'retry' | 'dead' | 'deferred';

export class JobRunner {
  private readonly handlers = new Map<string, JobHandler>();
  private lastStaleSweep = 0;

  constructor(
    private readonly db: Db,
    private readonly o: RunnerOptions,
  ) {}

  register(h: JobHandler): this {
    if (this.handlers.has(h.kind)) throw new Error(`duplicate handler for ${h.kind}`);
    this.handlers.set(h.kind, h);
    return this;
  }

  get kinds(): string[] {
    return [...this.handlers.keys()];
  }

  private get maxAttempts(): number {
    return this.o.maxAttempts ?? MAX_ATTEMPTS;
  }

  /** Unlock jobs whose worker died mid-run (the attempt still counts). */
  async releaseStale(): Promise<number> {
    const r = await this.db.query(
      `UPDATE jobs SET locked_at = NULL, last_error = coalesce(last_error, 'lock expired')
       WHERE locked_at IS NOT NULL AND locked_at < now() - make_interval(secs => $1)`,
      [(this.o.staleLockMs ?? 15 * 60_000) / 1000],
    );
    return r.rowCount ?? 0;
  }

  /** Claim and run at most one ready job. Only kinds with a registered handler are claimed. */
  async runOnce(signal: AbortSignal = new AbortController().signal): Promise<RunOutcome> {
    if (Date.now() - this.lastStaleSweep > 60_000) {
      this.lastStaleSweep = Date.now();
      await this.releaseStale();
    }
    const kinds = this.kinds;
    if (kinds.length === 0) return 'idle';
    const claimed = await this.db.query<{ id: string; kind: string; payload: unknown; attempts: number }>(
      `UPDATE jobs SET locked_at = now(), attempts = attempts + 1
       WHERE id = (
         SELECT id FROM jobs
         WHERE locked_at IS NULL AND run_after <= now() AND attempts < $1 AND kind = ANY($2::text[])
         ORDER BY run_after, id
         LIMIT 1
         FOR UPDATE SKIP LOCKED)
       RETURNING id, kind, payload, attempts`,
      [this.maxAttempts, kinds],
    );
    const row = claimed.rows[0];
    if (!row) return 'idle';
    const job: Job = { id: Number(row.id), kind: row.kind, payload: row.payload, attempts: row.attempts };
    const handler = this.handlers.get(job.kind)!;
    const log = this.o.log.child({ job_id: job.id, kind: job.kind, attempt: job.attempts });

    if (handler.ai) {
      const gate = await this.o.budget.check();
      if (!gate.open) {
        // Hold this job and every other ready AI job until the reset; the claim's attempt is given back.
        const aiKinds = [...this.handlers.values()].filter((h) => h.ai).map((h) => h.kind);
        await this.db.query(
          `UPDATE jobs SET locked_at = NULL, attempts = attempts - 1, run_after = $2 WHERE id = $1`,
          [job.id, gate.resumeAt],
        );
        const held = await this.db.query(
          `UPDATE jobs SET run_after = $1
           WHERE locked_at IS NULL AND run_after < $1 AND attempts < $2 AND kind = ANY($3::text[])`,
          [gate.resumeAt, this.maxAttempts, aiKinds],
        );
        log.warn('ai budget reached; holding ai jobs until reset', {
          used: gate.used,
          ceiling: gate.ceiling,
          resume_at: gate.resumeAt?.toISOString(),
          held: (held.rowCount ?? 0) + 1,
        });
        return 'deferred';
      }
    }

    const started = Date.now();
    try {
      await handler.run(job, signal);
      await this.db.query('DELETE FROM jobs WHERE id = $1', [job.id]);
      log.info('job done', { ms: Date.now() - started });
      return 'done';
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      if (job.attempts >= this.maxAttempts) {
        await this.db.query('UPDATE jobs SET locked_at = NULL, last_error = $2 WHERE id = $1', [job.id, msg.slice(0, 2000)]);
        log.error('job failed permanently', { err: msg });
        return 'dead';
      }
      const delay = backoffMs(job.attempts, this.o.baseBackoffMs, this.o.maxBackoffMs);
      await this.db.query(
        `UPDATE jobs SET locked_at = NULL, last_error = $2, run_after = now() + make_interval(secs => $3) WHERE id = $1`,
        [job.id, msg.slice(0, 2000), delay / 1000],
      );
      log.warn('job failed; will retry', { err: msg, retry_in_ms: delay });
      return 'retry';
    }
  }

  /** Loop until `signal` aborts. Resolves once the in-flight job (if any) has finished. */
  async run(signal: AbortSignal): Promise<void> {
    const pollMs = this.o.pollMs ?? 5_000;
    while (!signal.aborted) {
      let outcome: RunOutcome;
      try {
        outcome = await this.runOnce(signal);
      } catch (err) {
        this.o.log.error('job runner error', { err });
        outcome = 'idle';
      }
      if (outcome === 'idle' || outcome === 'deferred') await sleep(pollMs, signal);
    }
  }
}
