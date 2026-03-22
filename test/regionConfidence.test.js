import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRegionConfidence } from '../src/utils/regionConfidence.js';

test('high confidence for well-covered region', () => {
  const score = computeRegionConfidence({
    sourceCount: 8, sourceDiversity: 0.8, recencyHours: 1, geocodePrecision: 'locality'
  });
  assert.ok(score >= 0.7);
});

test('low confidence for sparse region', () => {
  const score = computeRegionConfidence({
    sourceCount: 1, sourceDiversity: 0.1, recencyHours: 48, geocodePrecision: 'country'
  });
  assert.ok(score <= 0.4);
});

test('medium confidence for average region', () => {
  const score = computeRegionConfidence({
    sourceCount: 3, sourceDiversity: 0.5, recencyHours: 6, geocodePrecision: 'country'
  });
  assert.ok(score >= 0.3 && score <= 0.7);
});

test('returns 0-1 range', () => {
  const low = computeRegionConfidence({ sourceCount: 0, sourceDiversity: 0, recencyHours: 999, geocodePrecision: 'unknown' });
  const high = computeRegionConfidence({ sourceCount: 20, sourceDiversity: 1, recencyHours: 0, geocodePrecision: 'locality' });
  assert.ok(low >= 0 && low <= 1);
  assert.ok(high >= 0 && high <= 1);
});
