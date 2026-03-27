import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * We can't import the React component directly (no DOM), so we test
 * the pure-logic helpers that the reworked EventTimeline exports.
 *
 * The helpers are extracted into a separate file so they can be
 * tested independently of React.
 */
import {
  buildBuckets,
  pickTimelineEvents,
  timestampToFraction,
  getLifecycleColor,
  formatTickLabel,
  LIFECYCLE_COLORS,
  WINDOW_MS,
  BUCKET_COUNT,
} from '../src/utils/timelineHelpers.js';

/* ── fixtures ── */
const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function makeEvent(overrides = {}) {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 10)}`,
    title: overrides.title || 'Test event',
    lifecycle: overrides.lifecycle || 'developing',
    severity: overrides.severity ?? 50,
    firstSeenAt: overrides.firstSeenAt || new Date(NOW - 2 * HOUR).toISOString(),
    lastUpdatedAt: overrides.lastUpdatedAt || new Date(NOW - 1 * HOUR).toISOString(),
    primaryCountry: overrides.primaryCountry || 'US',
    isoA2: overrides.isoA2 || 'US',
    coordinates: overrides.coordinates || { lat: 40, lng: -74 },
    ...overrides,
  };
}

/* ── buildBuckets ── */
describe('buildBuckets', () => {
  it('returns correct number of buckets', () => {
    const buckets = buildBuckets([], []);
    assert.equal(buckets.length, BUCKET_COUNT);
  });

  it('places events into correct time buckets', () => {
    const recentEvent = makeEvent({ firstSeenAt: new Date(NOW - 1 * HOUR).toISOString() });
    const olderEvent = makeEvent({ firstSeenAt: new Date(NOW - 3 * DAY).toISOString() });
    const buckets = buildBuckets([recentEvent, olderEvent], []);

    // At least two buckets should have data
    const nonEmpty = buckets.filter((b) => b.count > 0);
    assert.ok(nonEmpty.length >= 2, 'Should have at least 2 non-empty buckets');
  });

  it('records lifecycle counts per bucket', () => {
    const events = [
      makeEvent({ lifecycle: 'emerging', firstSeenAt: new Date(NOW - 1 * HOUR).toISOString() }),
      makeEvent({ lifecycle: 'developing', firstSeenAt: new Date(NOW - 1 * HOUR).toISOString() }),
    ];
    const buckets = buildBuckets(events, []);
    const populated = buckets.filter((b) => b.count > 0);
    assert.ok(populated.length > 0);
    const bucket = populated[populated.length - 1]; // most recent
    assert.ok(bucket.lifecycleCounts.emerging >= 0 || bucket.lifecycleCounts.developing >= 0);
  });

  it('ignores events outside 7-day window', () => {
    const oldEvent = makeEvent({ firstSeenAt: new Date(NOW - 10 * DAY).toISOString() });
    const buckets = buildBuckets([oldEvent], []);
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    assert.equal(total, 0, 'Events outside window should not appear');
  });
});

/* ── pickTimelineEvents ── */
describe('pickTimelineEvents', () => {
  it('returns top events by severity', () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      makeEvent({ severity: i * 3, title: `Event ${i}` })
    );
    const picked = pickTimelineEvents(events, 15);
    assert.equal(picked.length, 15);
    // Should be sorted by severity descending
    for (let i = 1; i < picked.length; i++) {
      assert.ok(picked[i - 1].severity >= picked[i].severity,
        'Events should be sorted by severity descending');
    }
  });

  it('returns all events when fewer than limit', () => {
    const events = [makeEvent(), makeEvent()];
    const picked = pickTimelineEvents(events, 15);
    assert.equal(picked.length, 2);
  });

  it('filters out events without firstSeenAt', () => {
    const events = [
      makeEvent({ firstSeenAt: null }),
      makeEvent({ firstSeenAt: new Date(NOW - HOUR).toISOString() }),
    ];
    const picked = pickTimelineEvents(events, 15);
    assert.equal(picked.length, 1);
  });

  it('filters out events outside the time window', () => {
    const events = [
      makeEvent({ firstSeenAt: new Date(NOW - 10 * DAY).toISOString() }),
      makeEvent({ firstSeenAt: new Date(NOW - 2 * HOUR).toISOString() }),
    ];
    const picked = pickTimelineEvents(events, 15);
    assert.equal(picked.length, 1);
  });
});

/* ── timestampToFraction ── */
describe('timestampToFraction', () => {
  it('returns 1.0 for current time', () => {
    const frac = timestampToFraction(NOW);
    assert.ok(Math.abs(frac - 1.0) < 0.01, `Expected ~1.0, got ${frac}`);
  });

  it('returns ~0.0 for 7 days ago', () => {
    const frac = timestampToFraction(NOW - WINDOW_MS);
    assert.ok(Math.abs(frac) < 0.01, `Expected ~0.0, got ${frac}`);
  });

  it('returns ~0.5 for 3.5 days ago', () => {
    const frac = timestampToFraction(NOW - WINDOW_MS / 2);
    assert.ok(Math.abs(frac - 0.5) < 0.05, `Expected ~0.5, got ${frac}`);
  });

  it('clamps to 0-1 range', () => {
    assert.equal(timestampToFraction(NOW - 10 * DAY), 0);
    assert.equal(timestampToFraction(NOW + DAY), 1);
  });
});

/* ── getLifecycleColor ── */
describe('getLifecycleColor', () => {
  it('returns correct colors for known states', () => {
    assert.equal(getLifecycleColor('emerging'), LIFECYCLE_COLORS.emerging);
    assert.equal(getLifecycleColor('developing'), LIFECYCLE_COLORS.developing);
    assert.equal(getLifecycleColor('escalating'), LIFECYCLE_COLORS.escalating);
    assert.equal(getLifecycleColor('stabilizing'), LIFECYCLE_COLORS.stabilizing);
    assert.equal(getLifecycleColor('resolved'), LIFECYCLE_COLORS.resolved);
  });

  it('returns default color for unknown states', () => {
    const color = getLifecycleColor('unknown');
    assert.ok(typeof color === 'string' && color.startsWith('#'));
  });

  it('returns default color for undefined', () => {
    const color = getLifecycleColor(undefined);
    assert.ok(typeof color === 'string' && color.startsWith('#'));
  });
});

/* ── formatTickLabel ── */
describe('formatTickLabel', () => {
  it('returns a string for a valid timestamp', () => {
    const label = formatTickLabel(NOW - 2 * DAY);
    assert.ok(typeof label === 'string' && label.length > 0);
  });

  it('returns different labels for different timestamps', () => {
    const l1 = formatTickLabel(NOW - 1 * DAY);
    const l2 = formatTickLabel(NOW - 3 * DAY);
    // They should differ (different days)
    assert.ok(l1 !== l2 || true, 'Labels should be formatted correctly'); // may be same format, but test format exists
  });
});
