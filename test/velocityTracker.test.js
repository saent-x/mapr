import test from 'node:test';
import assert from 'node:assert/strict';
import { computeZScore, computeVelocitySpikes } from '../server/velocityTracker.js';

test('computeZScore returns 0 for no history', () => {
  assert.equal(computeZScore(5, []), 0);
});

test('computeZScore detects spike above 2 stddev', () => {
  const history = [2, 3, 2, 3, 2, 3, 2];
  const z = computeZScore(10, history);
  assert.ok(z >= 2.0);
});

test('computeZScore returns 0 for normal activity', () => {
  const history = [10, 12, 11, 10, 12, 11, 10];
  const z = computeZScore(11, history);
  assert.ok(z < 1.5);
});

test('computeVelocitySpikes flags spike regions', () => {
  const regionHistory = {
    'NG': { counts: [2, 3, 2, 3, 2, 3, 2], currentCount: 12 },
    'US': { counts: [10, 12, 11, 10, 12, 11, 10], currentCount: 11 }
  };
  const spikes = computeVelocitySpikes(regionHistory);
  assert.ok(spikes.some(s => s.iso === 'NG' && s.level === 'spike'));
  assert.ok(!spikes.some(s => s.iso === 'US'));
});

test('computeVelocitySpikes flags elevated regions', () => {
  const regionHistory = {
    'SD': { counts: [5, 5, 5, 5, 5, 5, 5], currentCount: 9 }
  };
  const spikes = computeVelocitySpikes(regionHistory);
  assert.ok(spikes.some(s => s.iso === 'SD' && s.level === 'elevated'));
});
