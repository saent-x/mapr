import { describe, expect, it } from 'vitest';
import { budgetDecision, nextUtcMidnight, pacedAllowance, utcDay } from '../src/jobs/budget.js';
import { backoffMs, triageKey } from '../src/jobs/queue.js';

const NOW = new Date('2026-10-23T22:15:00Z');

describe('budget gate', () => {
  it('is open with no usage row', () => {
    expect(budgetDecision(null, 9000, NOW)).toEqual({ open: true, used: 0, ceiling: 9000, resumeAt: null, paced: false });
  });
  it('is open below the ceiling using MAPR neurons only when account is unknown', () => {
    expect(budgetDecision({ maprNeurons: 8999.9, accountNeurons: null }, 9000, NOW).open).toBe(true);
  });
  it('does not double-count MAPR use already inside the account figure', () => {
    const d = budgetDecision({ maprNeurons: 4000, accountNeurons: 5000, maprNeuronsAtRead: 4000 }, 9000, NOW);
    expect(d.open).toBe(true);
    expect(d.used).toBe(5000);
  });
  it('adds MAPR use since the account figure was read', () => {
    const d = budgetDecision({ maprNeurons: 7000, accountNeurons: 5000, maprNeuronsAtRead: 3000 }, 9000, NOW);
    expect(d.open).toBe(false);
    expect(d.used).toBe(9000);
  });
  it('never reports less than MAPR alone', () => {
    expect(budgetDecision({ maprNeurons: 6000, accountNeurons: 2000, maprNeuronsAtRead: 6000 }, 9000, NOW).used).toBe(6000);
  });
  it('closes at the ceiling and resumes at the next 00:00 UTC', () => {
    const d = budgetDecision({ maprNeurons: 9000, accountNeurons: null }, 9000, NOW);
    expect(d.open).toBe(false);
    expect(d.resumeAt?.toISOString()).toBe('2026-10-24T00:00:00.000Z');
  });
  it('when paced, releases the ceiling evenly over the day after a head start', () => {
    const H = 3_600_000;
    expect(pacedAllowance(9000, new Date('2026-10-23T00:00:00Z'), H)).toBe(375);
    expect(pacedAllowance(9000, new Date('2026-10-23T11:00:00Z'), H)).toBe(4500);
    expect(pacedAllowance(9000, new Date('2026-10-23T23:30:00Z'), H)).toBe(9000);
    const at6 = new Date('2026-10-23T06:00:00Z'); // allowance 2625
    expect(budgetDecision({ maprNeurons: 2600, accountNeurons: null }, 9000, at6, H).open).toBe(true);
    const d = budgetDecision({ maprNeurons: 3000, accountNeurons: null }, 9000, at6, H);
    expect(d).toMatchObject({ open: false, paced: true });
    expect(d.resumeAt?.toISOString()).toBe('2026-10-23T07:00:00.000Z'); // 3000 is released at 08:00 - 1h head start
    expect(budgetDecision({ maprNeurons: 9000, accountNeurons: null }, 9000, at6, H)).toMatchObject({ open: false, paced: false });
  });
  it('computes UTC days and midnights across month and year ends', () => {
    expect(utcDay(new Date('2026-10-23T23:59:59-05:00'))).toBe('2026-10-24');
    expect(nextUtcMidnight(new Date('2026-12-31T23:00:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(nextUtcMidnight(new Date('2026-10-24T00:00:00Z')).toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });
});

describe('queue helpers', () => {
  it('backs off exponentially with a cap', () => {
    expect(backoffMs(1, 1000, 60_000)).toBe(1000);
    expect(backoffMs(2, 1000, 60_000)).toBe(2000);
    expect(backoffMs(5, 1000, 60_000)).toBe(16_000);
    expect(backoffMs(8, 1000, 60_000)).toBe(60_000);
  });
  it('formats triage dedupe keys', () => expect(triageKey(42, 3)).toBe('triage:42:3'));
});
