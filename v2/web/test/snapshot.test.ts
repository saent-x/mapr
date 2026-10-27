import { describe, expect, it } from 'vitest';
import { merge, prune, sortEvents } from '../src/snapshot';
import { ev, hoursAgo, NOW } from './fixtures';

describe('merge', () => {
  it('adds new events and reports them as upserts', () => {
    const r = merge([], [ev(1), ev(2)], NOW);
    expect(r.events.map((e) => e.id).sort()).toEqual([1, 2]);
    expect(r.upsert.map((e) => e.id).sort()).toEqual([1, 2]);
    expect(r.remove).toEqual([]);
  });

  it('drops relevant === false, and removes an event that turns irrelevant', () => {
    const r1 = merge([], [ev(1), ev(2, { relevant: false })], NOW);
    expect(r1.events.map((e) => e.id)).toEqual([1]);
    expect(r1.upsert.map((e) => e.id)).toEqual([1]);
    expect(r1.remove).toEqual([]); // never shown, so nothing to retract

    const r2 = merge(r1.events, [ev(1, { relevant: false })], NOW);
    expect(r2.events).toEqual([]);
    expect(r2.remove).toEqual([1]);
    expect(r2.upsert).toEqual([]);
  });

  it('keeps untriaged events (relevant === null)', () => {
    expect(merge([], [ev(1, { relevant: null, severity: null })], NOW).events).toHaveLength(1);
  });

  it('expires events whose updated_at is older than 24h', () => {
    const prev = [ev(1, { updated_at: hoursAgo(25) }), ev(2, { updated_at: hoursAgo(23) })];
    const r = merge(prev, [ev(3, { updated_at: hoursAgo(24.5) })], NOW);
    expect(r.events.map((e) => e.id)).toEqual([2]);
    expect(r.upsert).toEqual([]);
    expect(prune(prev, NOW).map((e) => e.id)).toEqual([2]);
  });

  it('reports no change when an identical event comes back', () => {
    const prev = merge([], [ev(1)], NOW).events;
    const r = merge(prev, [ev(1)], NOW);
    expect(r.upsert).toEqual([]);
    expect(r.remove).toEqual([]);
    const r2 = merge(prev, [ev(1, { source_count: 2 })], NOW);
    expect(r2.upsert.map((e) => e.source_count)).toEqual([2]);
  });

  it('keeps the latest version when an id appears twice in one batch', () => {
    const r = merge([], [ev(1, { title: 'a' }), ev(1, { title: 'b' })], NOW);
    expect(r.events.map((e) => e.title)).toEqual(['b']);
    expect(r.upsert.map((e) => e.title)).toEqual(['b']);
  });
});

describe('sortEvents', () => {
  it('orders by severity desc (null last), then updated_at desc, then id desc', () => {
    const sorted = sortEvents([
      ev(1, { severity: 1, updated_at: hoursAgo(1) }),
      ev(2, { severity: null, updated_at: hoursAgo(0.1) }),
      ev(3, { severity: 4, updated_at: hoursAgo(5) }),
      ev(4, { severity: 2, updated_at: hoursAgo(3) }),
      ev(5, { severity: 2, updated_at: hoursAgo(2) }),
      ev(6, { severity: 2, updated_at: hoursAgo(2) }),
    ]);
    expect(sorted.map((e) => e.id)).toEqual([3, 6, 5, 4, 1, 2]);
  });
});
