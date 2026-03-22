import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateEventId,
  computeTopicFingerprint,
  LIFECYCLE_STATES,
  computeLifecycleTransition
} from '../src/utils/eventModel.js';

test('computeTopicFingerprint returns sorted top tokens', () => {
  const articles = [
    { title: 'Turkey earthquake kills hundreds in southern region' },
    { title: 'Earthquake in Turkey leaves hundreds dead' },
    { title: 'Southern Turkey hit by devastating earthquake' }
  ];
  const fp = computeTopicFingerprint(articles);
  assert.ok(Array.isArray(fp));
  assert.ok(fp.length <= 5);
  assert.ok(fp.includes('earthquake'));
  assert.ok(fp.includes('turkey'));
  const sorted = [...fp].sort();
  assert.deepEqual(fp, sorted);
});

test('generateEventId is stable for same inputs', () => {
  const id1 = generateEventId('TR', ['earthquake', 'turkey', 'hundreds']);
  const id2 = generateEventId('TR', ['earthquake', 'turkey', 'hundreds']);
  assert.equal(id1, id2);
  assert.ok(id1.startsWith('evt-'));
  assert.equal(id1.length, 20);
});

test('generateEventId differs for different countries', () => {
  const id1 = generateEventId('TR', ['earthquake', 'turkey']);
  const id2 = generateEventId('SY', ['earthquake', 'turkey']);
  assert.notEqual(id1, id2);
});

test('generateEventId differs for different topics', () => {
  const id1 = generateEventId('TR', ['earthquake', 'turkey']);
  const id2 = generateEventId('TR', ['protest', 'istanbul']);
  assert.notEqual(id1, id2);
});

test('new event starts as emerging', () => {
  const now = Date.now();
  const state = computeLifecycleTransition({
    lifecycle: null,
    firstSeenAt: new Date(now - 30 * 60 * 1000).toISOString(),
    articleCount: 2,
    lastUpdatedAt: new Date(now - 10 * 60 * 1000).toISOString(),
    prevWindowArticleCount: 0,
    currWindowArticleCount: 2
  });
  assert.equal(state, 'emerging');
});

test('event with 4 sources transitions to developing', () => {
  const now = Date.now();
  const state = computeLifecycleTransition({
    lifecycle: 'emerging',
    firstSeenAt: new Date(now - 60 * 60 * 1000).toISOString(),
    articleCount: 4,
    lastUpdatedAt: new Date(now - 5 * 60 * 1000).toISOString(),
    prevWindowArticleCount: 1,
    currWindowArticleCount: 3
  });
  assert.equal(state, 'developing');
});

test('event with 50%+ velocity increase transitions to escalating', () => {
  const now = Date.now();
  const state = computeLifecycleTransition({
    lifecycle: 'developing',
    firstSeenAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
    articleCount: 12,
    lastUpdatedAt: new Date(now - 5 * 60 * 1000).toISOString(),
    prevWindowArticleCount: 3,
    currWindowArticleCount: 7
  });
  assert.equal(state, 'escalating');
});

test('event with no articles in 6h transitions to stabilizing', () => {
  const now = Date.now();
  const state = computeLifecycleTransition({
    lifecycle: 'escalating',
    firstSeenAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    articleCount: 20,
    lastUpdatedAt: new Date(now - 7 * 60 * 60 * 1000).toISOString(),
    prevWindowArticleCount: 5,
    currWindowArticleCount: 0
  });
  assert.equal(state, 'stabilizing');
});

test('event with no articles in 24h transitions to resolved', () => {
  const now = Date.now();
  const state = computeLifecycleTransition({
    lifecycle: 'developing',
    firstSeenAt: new Date(now - 72 * 60 * 60 * 1000).toISOString(),
    articleCount: 8,
    lastUpdatedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
    prevWindowArticleCount: 0,
    currWindowArticleCount: 0
  });
  assert.equal(state, 'resolved');
});

test('resolved takes priority over other rules', () => {
  const now = Date.now();
  const state = computeLifecycleTransition({
    lifecycle: 'escalating',
    firstSeenAt: new Date(now - 72 * 60 * 60 * 1000).toISOString(),
    articleCount: 50,
    lastUpdatedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
    prevWindowArticleCount: 10,
    currWindowArticleCount: 8
  });
  assert.equal(state, 'resolved');
});
