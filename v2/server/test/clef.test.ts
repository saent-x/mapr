import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db.js';
import { CLEF_FLASH_NEURONS_PER_M, ClefTriager, readAnswers, triageState } from '../src/jobs/clef.js';
import type { TriageEvent } from '../src/jobs/triage.js';

const EV: TriageEvent = {
  id: 7,
  title: 'Fire at Jeddah container terminal',
  summary: null,
  firstSeen: new Date('2026-10-24T01:00:00Z'),
  lastSeen: new Date('2026-10-24T02:00:00Z'),
  sourceCount: 2,
  articleCount: 3,
  milestone: 1,
  sources: [
    { sourceId: 1, source: 'Wire A', url: 'https://a/1', title: 'Terminal fire in Jeddah', publishedAt: new Date('2026-10-24T01:00:00Z'), span: 'Two carriers paused berthing.' },
    { sourceId: 2, source: 'Wire B', url: 'https://b/1', title: 'Jeddah port blaze', publishedAt: null, span: null },
  ],
};

function fakeDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const q = { query: async (sql: string, params: unknown[] = []) => (calls.push({ sql, params }), { rows: [], rowCount: 0 }) } as unknown as Queryable;
  return { q, calls };
}

describe('readAnswers', () => {
  it('maps Clef probabilities to event columns', () => {
    const r = readAnswers({
      relevant: { noul: 0.92 },
      category: { choice: 'maritime', confidence: 0.8 },
      severity: { score: 1.8, probabilities: [0.05, 0.2, 0.6, 0.15] },
    });
    expect(r).toEqual({ relevant: true, relevanceConf: 0.92, category: 'maritime', severity: 3, severityConf: 0.6 });
  });
  it('reports confidence in a "no" as 1 - p, and falls back to distance from the level', () => {
    const r = readAnswers({ relevant: { noul: 0.1 }, category: { choice: 'other' }, severity: { score: 0.25 } });
    expect(r.relevant).toBe(false);
    expect(r.relevanceConf).toBeCloseTo(0.9);
    expect(r.severity).toBe(1);
    expect(r.severityConf).toBeCloseTo(0.75);
  });
  it('rejects an incomplete answer or an unknown category so the job retries', () => {
    expect(() => readAnswers({ relevant: { noul: 0.5 }, severity: { score: 1 } })).toThrow('incomplete');
    expect(() => readAnswers({ relevant: { noul: 0.5 }, category: { choice: 'sports' }, severity: { score: 1 } })).toThrow('incomplete');
  });
});

describe('triageState', () => {
  it('passes the event as data and caps the sources', () => {
    const many = { ...EV, sources: Array.from({ length: 20 }, (_, i) => ({ ...EV.sources[0]!, url: `https://a/${i}` })) };
    const s = JSON.parse(triageState(many));
    expect(s.event).toBe(EV.title);
    expect(s.sources).toHaveLength(12);
    expect(s.sources[0]).toEqual({ outlet: 'Wire A', headline: 'Terminal fire in Jeddah', excerpt: 'Two carriers paused berthing.', published: '2026-10-24T01:00:00.000Z' });
  });
});

describe('ClefTriager', () => {
  it('calls Clef-flash, records neurons and writes the result', async () => {
    const { q, calls } = fakeDb();
    let sent: { url: string; body: { model: string; questions: Record<string, unknown> } } | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      sent = { url: String(url), body: JSON.parse(String(init?.body)) };
      return Response.json({
        success: true,
        result: {
          answers: { relevant: { noul: 0.97 }, category: { choice: 'maritime' }, severity: { score: 2.1 } },
          usage: { prompt_tokens: 1000 },
        },
      });
    }) as typeof fetch;
    await new ClefTriager(q, { accountId: 'acct', apiToken: 'tok', fetchImpl }).triageEvent(EV);

    expect(sent!.url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/cloudflare/clef-flash');
    expect(sent!.body.model).toBe('clef-flash');
    expect(Object.keys(sent!.body.questions)).toEqual(['relevant', 'category', 'severity']);
    expect(calls[0]!.sql).toContain('ai_usage');
    expect(calls[0]!.params[1]).toBeCloseTo((1000 / 1e6) * CLEF_FLASH_NEURONS_PER_M);
    expect(calls[1]!.sql).toContain('UPDATE events');
    expect(calls[1]!.params.slice(0, 5)).toEqual([7, true, 0.97, 'maritime', 3]);
    expect(calls[2]!.sql).toContain('event_activity');
  });
  it('throws on an error answer so the job is retried, and writes nothing', async () => {
    const { q, calls } = fakeDb();
    const fetchImpl = (async () => Response.json({ success: false, errors: [{ message: 'quota' }] })) as typeof fetch;
    await expect(new ClefTriager(q, { accountId: 'a', apiToken: 't', fetchImpl }).triageEvent(EV)).rejects.toThrow('quota');
    expect(calls).toHaveLength(0);
  });
});
