import { describe, expect, it } from 'vitest';
import { cosine, crossedMilestones, decideCluster, updateCentroid } from '../src/cluster/decide.js';

const P = { threshold: 0.82, windowHours: 48 };
const T = new Date('2026-10-23T12:00:00Z');
const h = (hours: number) => new Date(T.getTime() + hours * 3_600_000);

describe('decideCluster', () => {
  it('creates when there are no candidates', () => {
    expect(decideCluster([], T, P)).toEqual({ action: 'create', reason: 'no-candidates', bestSimilarity: null });
  });
  it('joins the most similar event above the threshold within the window', () => {
    const d = decideCluster(
      [
        { eventId: 1, similarity: 0.83, lastSeen: h(-1) },
        { eventId: 2, similarity: 0.91, lastSeen: h(-10) },
        { eventId: 3, similarity: 0.5, lastSeen: h(0) },
      ],
      T,
      P,
    );
    expect(d).toEqual({ action: 'join', eventId: 2, similarity: 0.91 });
  });
  it('treats the threshold as inclusive', () => {
    expect(decideCluster([{ eventId: 7, similarity: 0.82, lastSeen: T }], T, P).action).toBe('join');
    expect(decideCluster([{ eventId: 7, similarity: 0.8199, lastSeen: T }], T, P)).toMatchObject({ action: 'create', reason: 'below-threshold' });
  });
  it('refuses events whose last_seen is more than 48h from the article', () => {
    expect(decideCluster([{ eventId: 1, similarity: 0.95, lastSeen: h(-49) }], T, P)).toMatchObject({ action: 'create', reason: 'outside-window' });
    expect(decideCluster([{ eventId: 1, similarity: 0.95, lastSeen: h(-48) }], T, P).action).toBe('join');
    // A late-arriving report published before the event's newest article still joins.
    expect(decideCluster([{ eventId: 1, similarity: 0.95, lastSeen: h(30) }], T, P).action).toBe('join');
  });
  it('falls back to the next similar event when the best is out of window', () => {
    const d = decideCluster(
      [
        { eventId: 1, similarity: 0.97, lastSeen: h(-100) },
        { eventId: 2, similarity: 0.86, lastSeen: h(-2) },
      ],
      T,
      P,
    );
    expect(d).toEqual({ action: 'join', eventId: 2, similarity: 0.86 });
  });
  it('honours a configured threshold', () => {
    expect(decideCluster([{ eventId: 1, similarity: 0.7, lastSeen: T }], T, { ...P, threshold: 0.65 }).action).toBe('join');
  });
});

describe('updateCentroid', () => {
  it('starts from the first vector, normalised', () => {
    expect(updateCentroid(null, 0, [3, 4])).toEqual([0.6, 0.8]);
  });
  it('is a normalised running mean', () => {
    const c = updateCentroid([1, 0], 1, [0, 1]);
    expect(c[0]).toBeCloseTo(Math.SQRT1_2);
    expect(c[1]).toBeCloseTo(Math.SQRT1_2);
    const heavy = updateCentroid([1, 0], 9, [0, 1]);
    expect(cosine(heavy, [1, 0])).toBeGreaterThan(0.99);
    expect(Math.hypot(...heavy)).toBeCloseTo(1);
  });
});

describe('crossedMilestones', () => {
  it('fires re-triage at the 3rd and 6th distinct source only', () => {
    expect(crossedMilestones(1, 2)).toEqual([]);
    expect(crossedMilestones(2, 3)).toEqual([3]);
    expect(crossedMilestones(3, 3)).toEqual([]);
    expect(crossedMilestones(3, 4)).toEqual([]);
    expect(crossedMilestones(5, 6)).toEqual([6]);
    expect(crossedMilestones(2, 7)).toEqual([3, 6]);
    expect(crossedMilestones(6, 9)).toEqual([]);
  });
});
