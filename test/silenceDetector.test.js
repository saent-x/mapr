import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSilence, computeSilenceMap } from '../src/utils/silenceDetector.js';

test('flags anomalous silence when current < 30% of average', () => {
  const result = detectSilence({ iso: 'NG', currentCount: 1, rollingAverage: 10 });
  assert.equal(result.status, 'anomalous-silence');
});

test('flags blind spot when zero sources and GDELT reports activity', () => {
  const result = detectSilence({ iso: 'ER', currentCount: 0, rollingAverage: 0, gdeltActive: true });
  assert.equal(result.status, 'blind-spot');
});

test('flags limited access for known restricted countries', () => {
  const result = detectSilence({ iso: 'KP', currentCount: 0, rollingAverage: 0 });
  assert.equal(result.status, 'limited-access');
});

test('returns covered for normal activity', () => {
  const result = detectSilence({ iso: 'US', currentCount: 15, rollingAverage: 12 });
  assert.equal(result.status, 'covered');
});

test('flags sparse when low but not silent', () => {
  const result = detectSilence({ iso: 'TD', currentCount: 3, rollingAverage: 8 });
  assert.equal(result.status, 'sparse');
});

test('computeSilenceMap processes multiple regions', () => {
  const regions = [
    { iso: 'NG', currentCount: 1, rollingAverage: 10 },
    { iso: 'US', currentCount: 15, rollingAverage: 12 },
    { iso: 'KP', currentCount: 0, rollingAverage: 0 }
  ];
  const map = computeSilenceMap(regions);
  assert.equal(map.NG.status, 'anomalous-silence');
  assert.equal(map.US.status, 'covered');
  assert.equal(map.KP.status, 'limited-access');
});
