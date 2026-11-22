// Triage with Clef-flash (Workers AI): is the event worth tracking, what kind of
// event is it, how severe. Clef returns calibrated probabilities, not text, so a
// feed cannot inject an answer, only nudge the probabilities.

import type { Queryable } from '../db.js';
import { recordNeurons } from './budget.js';
import type { TriageEvent, Triager } from './triage.js';

export const CLEF_FLASH = '@cf/cloudflare/clef-flash';
/** Workers AI price for Clef-flash input; Clef charges no output tokens. */
export const CLEF_FLASH_NEURONS_PER_M = 3455;

export const CATEGORIES: Record<string, string> = {
  conflict: 'Armed conflict, military action, terrorism, airstrikes',
  unrest: 'Protests, riots, coups, political violence',
  political: 'Elections, government decisions, sanctions, diplomacy',
  seismic: 'Earthquakes, tsunamis, volcanic eruptions',
  weather: 'Storms, floods, wildfires, droughts, heatwaves',
  health: 'Outbreaks, epidemics, health emergencies',
  cyber: 'Cyberattacks, data breaches, outages of critical systems',
  maritime: 'Shipping, ports, piracy, incidents at sea',
  economic: 'Markets, supply chains, energy, trade disruption',
  other: 'None of the above',
};

export const SEVERITY_LEVELS = [
  'Low: routine or local, no casualties, little disruption',
  'Elevated: notable disruption, tension or damage, few casualties',
  'High: many casualties, major disruption, or clear escalation',
  'Critical: mass casualties, war-level escalation, or a national emergency',
];

const QUESTIONS = {
  relevant: {
    type: 'noul',
    instructions:
      'Would an analyst watching global security, safety, political, economic or humanitarian risk want to track this event? ' +
      'Answer no for sports, entertainment, lifestyle, opinion pieces, adverts and routine company news.',
  },
  category: { type: 'choice', instructions: 'What kind of event is this?', criteria: CATEGORIES },
  severity: { type: 'score', instructions: 'How severe is the real-world impact?', criteria: SEVERITY_LEVELS },
};

/** What Clef reads: the event and what its sources say, as plain data. */
export function triageState(ev: TriageEvent): string {
  return JSON.stringify({
    event: ev.title,
    summary: ev.summary ?? undefined,
    first_seen: ev.firstSeen.toISOString(),
    sources: ev.sources.slice(0, 12).map((s) => ({
      outlet: s.source,
      headline: s.title,
      excerpt: s.span ?? undefined,
      published: s.publishedAt?.toISOString(),
    })),
    distinct_sources: ev.sourceCount,
  });
}

export interface TriageResult {
  relevant: boolean;
  relevanceConf: number;
  category: string;
  severity: number; // 1..4
  severityConf: number;
}

interface ClefAnswers {
  relevant?: { noul?: number };
  category?: { choice?: string; confidence?: number };
  severity?: { score?: number; probabilities?: number[] | Record<string, number> };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Turn Clef's answers into the event's columns. Throws on a malformed answer so the job retries. */
export function readAnswers(a: ClefAnswers): TriageResult {
  const p = a.relevant?.noul;
  const score = a.severity?.score;
  const cat = a.category?.choice;
  if (typeof p !== 'number' || typeof score !== 'number' || typeof cat !== 'string' || !(cat in CATEGORIES)) {
    throw new Error(`Clef answer is incomplete: ${JSON.stringify(a).slice(0, 300)}`);
  }
  const level = Math.min(3, Math.max(0, Math.round(score)));
  const probs = a.severity?.probabilities;
  const levelProb = Array.isArray(probs) ? probs[level] : probs ? Object.values(probs)[level] : undefined;
  return {
    relevant: p >= 0.5,
    relevanceConf: clamp01(p >= 0.5 ? p : 1 - p),
    category: cat,
    severity: level + 1,
    // Without per-level probabilities, distance from the nearest level is the best signal.
    severityConf: clamp01(typeof levelProb === 'number' ? levelProb : 1 - Math.abs(score - level)),
  };
}

export interface ClefTriagerOptions {
  accountId: string;
  apiToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class ClefTriager implements Triager {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly q: Queryable,
    private readonly o: ClefTriagerOptions,
  ) {
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(o.accountId)}/ai/run/${CLEF_FLASH}`;
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  async triageEvent(ev: TriageEvent): Promise<void> {
    const state = triageState(ev);
    const res = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.apiToken}` },
      body: JSON.stringify({ model: 'clef-flash', state, questions: QUESTIONS }),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 30_000),
    });
    if (!res.ok) throw new Error(`Clef-flash HTTP ${res.status}`);
    const body = (await res.json()) as {
      success?: boolean;
      result?: { answers?: ClefAnswers; usage?: { prompt_tokens?: number; input_tokens?: number } };
      errors?: Array<{ message?: string }>;
    };
    if (!body.success || !body.result?.answers) {
      throw new Error(`Clef-flash: ${body.errors?.map((e) => e.message).join('; ') || 'no answers'}`);
    }
    const usage = body.result.usage;
    const tokens = usage?.prompt_tokens ?? usage?.input_tokens ?? Math.ceil((state.length + JSON.stringify(QUESTIONS).length) / 3);
    await recordNeurons(this.q, (tokens / 1e6) * CLEF_FLASH_NEURONS_PER_M);

    const r = readAnswers(body.result.answers);
    await this.q.query(
      `UPDATE events SET relevant = $2, relevance_conf = $3, category = $4, severity = $5, severity_conf = $6, triaged_at = now()
       WHERE id = $1`,
      [ev.id, r.relevant, r.relevanceConf, r.category, r.severity, r.severityConf],
    );
    await this.q.query(
      `INSERT INTO event_activity (event_id, updated_at) VALUES ($1, now())
       ON CONFLICT (event_id) DO UPDATE SET updated_at = now()`,
      [ev.id],
    );
  }
}
