import test from 'node:test';
import assert from 'node:assert/strict';
import { diffEventSnapshots, buildSnapshotSummary } from '../src/services/eventCache.js';

test('diffEventSnapshots detects new events', () => {
  const previous = [{ id: 'evt-1', lifecycle: 'developing', severity: 70 }];
  const current = [
    { id: 'evt-1', lifecycle: 'developing', severity: 70 },
    { id: 'evt-2', lifecycle: 'emerging', severity: 50 }
  ];
  const diff = diffEventSnapshots(previous, current);
  assert.equal(diff.newEvents.length, 1);
  assert.equal(diff.newEvents[0].id, 'evt-2');
});

test('diffEventSnapshots detects lifecycle changes', () => {
  const previous = [{ id: 'evt-1', lifecycle: 'developing', severity: 70 }];
  const current = [{ id: 'evt-1', lifecycle: 'escalating', severity: 85 }];
  const diff = diffEventSnapshots(previous, current);
  assert.equal(diff.escalated.length, 1);
  assert.equal(diff.lifecycleChanges.length, 1);
});

test('diffEventSnapshots detects resolved/disappeared events', () => {
  const previous = [
    { id: 'evt-1', lifecycle: 'developing' },
    { id: 'evt-2', lifecycle: 'escalating' }
  ];
  const current = [{ id: 'evt-1', lifecycle: 'developing' }];
  const diff = diffEventSnapshots(previous, current);
  assert.equal(diff.resolved.length, 1);
  assert.equal(diff.resolved[0].id, 'evt-2');
});

test('handles first visit (empty previous)', () => {
  const diff = diffEventSnapshots([], [{ id: 'evt-1', lifecycle: 'emerging' }]);
  assert.equal(diff.isFirstVisit, true);
  assert.equal(diff.newEvents.length, 1);
});

test('buildSnapshotSummary creates readable text', () => {
  const diff = {
    newEvents: [{ id: '1' }], escalated: [], resolved: [{ id: '2' }],
    lifecycleChanges: [], isFirstVisit: false
  };
  const summary = buildSnapshotSummary(diff);
  assert.ok(summary.includes('1 new'));
  assert.ok(summary.includes('1 resolved'));
});
