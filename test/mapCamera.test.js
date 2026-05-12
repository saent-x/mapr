import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSelectedStoryCameraTarget,
  getStoryCoordinateCenter,
} from '../src/utils/mapCamera.js';

test('selected story without coordinates falls back to country bounds target', () => {
  const target = getSelectedStoryCameraTarget({
    id: 'hist-1',
    title: 'Historical event with no coordinates',
    isoA2: 'GB',
  });

  assert.deepEqual(target, { type: 'country', iso: 'GB' });
});

test('selected story without coordinates or region is a safe no-op target', () => {
  const target = getSelectedStoryCameraTarget({
    id: 'hist-2',
    title: 'Historical event with no location data',
  });

  assert.deepEqual(target, { type: 'none' });
});

test('story coordinate center validates coordinates before map fly-to', () => {
  assert.deepEqual(getStoryCoordinateCenter({ coordinates: [51.5, -0.12] }), [-0.12, 51.5]);
  assert.equal(getStoryCoordinateCenter({ coordinates: null }), null);
  assert.equal(getStoryCoordinateCenter({ coordinates: ['bad', -0.12] }), null);
});
