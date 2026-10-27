// Workers AI budget gate. Before any AI job runs, today's (UTC) neuron use is
// compared with the ceiling. Over the ceiling, the job is held until the next
// 00:00 UTC reset: nothing is ever skipped or downgraded.

import type { Queryable } from '../db.js';

export interface AiUsage {
  maprNeurons: number;
  /** Account-wide neurons from Cloudflare analytics, when known. Includes MAPR's own use. */
  accountNeurons: number | null;
  /** MAPR's counter at the moment accountNeurons was read. */
  maprNeuronsAtRead?: number | null;
}

export interface BudgetDecision {
  open: boolean;
  used: number;
  ceiling: number;
  /** When a closed gate opens again (next 00:00 UTC). */
  resumeAt: Date | null;
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/**
 * used = account-wide figure (which already counts MAPR) + what MAPR spent since
 * that figure was read; MAPR's own counter alone when the account is unknown.
 * Closed when used >= ceiling.
 */
export function budgetDecision(usage: AiUsage | null, ceiling: number, now: Date): BudgetDecision {
  const mapr = usage?.maprNeurons ?? 0;
  const account = usage?.accountNeurons ?? null;
  const used = account === null ? mapr : Math.max(mapr, account + Math.max(0, mapr - (usage?.maprNeuronsAtRead ?? 0)));
  const open = used < ceiling;
  return { open, used, ceiling, resumeAt: open ? null : nextUtcMidnight(now) };
}

export async function readUsage(q: Queryable, now: Date): Promise<AiUsage | null> {
  const r = await q.query<{ mapr_neurons: number; account_neurons: number | null; mapr_neurons_at_read: number | null }>(
    'SELECT mapr_neurons, account_neurons, mapr_neurons_at_read FROM ai_usage WHERE day = $1::date',
    [utcDay(now)],
  );
  const row = r.rows[0];
  const num = (v: number | null) => (v === null ? null : Number(v));
  return row
    ? { maprNeurons: Number(row.mapr_neurons), accountNeurons: num(row.account_neurons), maprNeuronsAtRead: num(row.mapr_neurons_at_read) }
    : null;
}

export class BudgetGate {
  constructor(
    private readonly q: Queryable,
    readonly ceiling: number,
  ) {}

  async check(now: Date = new Date()): Promise<BudgetDecision> {
    return budgetDecision(await readUsage(this.q, now), this.ceiling, now);
  }
}

/** Add neurons MAPR itself spent today (to be called by AI handlers after each call). */
export async function recordNeurons(q: Queryable, neurons: number, now: Date = new Date()): Promise<void> {
  await q.query(
    `INSERT INTO ai_usage (day, mapr_neurons) VALUES ($1::date, $2)
     ON CONFLICT (day) DO UPDATE SET mapr_neurons = ai_usage.mapr_neurons + EXCLUDED.mapr_neurons`,
    [utcDay(now), neurons],
  );
}

/** Store the account-wide figure read from Cloudflare analytics. */
export async function recordAccountNeurons(q: Queryable, neurons: number, now: Date = new Date()): Promise<void> {
  await q.query(
    `INSERT INTO ai_usage (day, account_neurons, account_read_at, mapr_neurons_at_read) VALUES ($1::date, $2, now(), 0)
     ON CONFLICT (day) DO UPDATE SET account_neurons = EXCLUDED.account_neurons, account_read_at = now(),
       mapr_neurons_at_read = ai_usage.mapr_neurons`,
    [utcDay(now), neurons],
  );
}
