import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../server/narrativeArcs.js';

const { parseVectorLiteral, cosine, average, eventEntityKeys, filterDurableClusters, clusterEvents } = __test__;

test('parseVectorLiteral parses pgvector textual form', () => {
  const v = parseVectorLiteral('[1,-0.5,0.25]');
  assert.deepEqual(v, [1, -0.5, 0.25]);
  assert.equal(parseVectorLiteral(''), null);
  assert.equal(parseVectorLiteral(null), null);
});

test('cosine = 1 for identical, 0 for orthogonal', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosine([1, 1], [1, 0]) - Math.cos(Math.PI / 4)) < 1e-9);
});

test('average returns mean across vectors', () => {
  assert.deepEqual(average([[2, 4], [4, 8]]), [3, 6]);
});

test('eventEntityKeys collects across kinds + lowercases', () => {
  const out = eventEntityKeys({
    entities: {
      people: ['Vladimir Putin'],
      organizations: [{ name: 'Wagner Group' }],
      locations: ['Rostov-on-Don'],
    },
  });
  assert.ok(out.has('vladimir putin'));
  assert.ok(out.has('wagner group'));
  assert.ok(out.has('rostov-on-don'));
});

test('filterDurableClusters keeps ≥5 events spanning ≥7d', () => {
  const day = 24 * 3600 * 1000;
  const baseTs = Date.now();
  const mkCluster = (n, spanDays) => ({
    centroid: [1],
    entityUnion: new Set(),
    events: Array.from({ length: n }, (_, i) => ({
      event: { firstSeenAt: new Date(baseTs - i * spanDays * day / Math.max(1, n - 1)).toISOString() },
      similarity: 0.9,
    })),
  });
  const tooFew = mkCluster(4, 10);
  const tooShort = mkCluster(6, 3);
  const ok = mkCluster(6, 10);
  const kept = filterDurableClusters([tooFew, tooShort, ok]);
  assert.equal(kept.length, 1);
});

test('clusterEvents requires entity overlap AND similarity', () => {
  const events = [
    { id: 'a', entities: { people: ['Alice'] } },
    { id: 'b', entities: { people: ['Alice', 'Bob'] } },
    { id: 'c', entities: { people: ['Charlie'] } },
  ];
  const centroids = new Map([
    ['a', [1, 0]],
    ['b', [0.99, 0.05]], // very similar to a
    ['c', [1, 0]],       // identical centroid to a, but no entity overlap
  ]);
  const clusters = clusterEvents(events, centroids);
  // a + b cluster together; c forms its own cluster (no shared entity).
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].events.length, 2);
  assert.equal(clusters[1].events.length, 1);
});
