import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeArticlesIntoEvents } from '../server/eventStore.js';

function makeArticle(overrides = {}) {
  return {
    id: `art-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Turkey earthquake kills hundreds',
    url: `https://example.com/${Math.random().toString(36).slice(2)}`,
    source: 'reuters',
    publishedAt: new Date().toISOString(),
    isoA2: 'TR',
    region: 'Turkey',
    severity: 80,
    category: 'Seismic',
    geocodePrecision: 'country',
    coordinates: [39.0, 35.0],
    ...overrides
  };
}

test('mergeArticlesIntoEvents creates a new event for first article', () => {
  const result = mergeArticlesIntoEvents([makeArticle()], []);
  assert.equal(result.length, 1);
  assert.ok(result[0].id.startsWith('evt-'));
  assert.equal(result[0].lifecycle, 'emerging');
  assert.equal(result[0].primaryCountry, 'TR');
  assert.equal(result[0].articleIds.length, 1);
});

test('mergeArticlesIntoEvents merges similar articles into same event', () => {
  const articles = [
    makeArticle({ title: 'Turkey earthquake kills hundreds in southern region' }),
    makeArticle({ title: 'Earthquake in Turkey leaves hundreds dead' }),
    makeArticle({ title: 'Southern Turkey hit by devastating earthquake' })
  ];
  const result = mergeArticlesIntoEvents(articles, []);
  assert.equal(result.length, 1);
  assert.equal(result[0].articleIds.length, 3);
});

test('mergeArticlesIntoEvents keeps separate events for different topics', () => {
  const articles = [
    makeArticle({ title: 'Turkey earthquake kills hundreds', isoA2: 'TR' }),
    makeArticle({ title: 'Mali conflict escalates amid Wagner deployment', isoA2: 'ML' })
  ];
  const result = mergeArticlesIntoEvents(articles, []);
  assert.equal(result.length, 2);
});

test('mergeArticlesIntoEvents merges into existing events', () => {
  const existingEvents = [{
    id: 'evt-existing',
    title: 'Turkey earthquake kills hundreds',
    primaryCountry: 'TR',
    countries: ['TR'],
    lifecycle: 'developing',
    severity: 75,
    category: 'Seismic',
    firstSeenAt: new Date(Date.now() - 3600000).toISOString(),
    lastUpdatedAt: new Date(Date.now() - 1800000).toISOString(),
    topicFingerprint: ['earthquake', 'hundreds', 'kills', 'southern', 'turkey'],
    articleIds: ['art-prev1', 'art-prev2']
  }];
  const articles = [makeArticle({ title: 'Earthquake death toll rises in Turkey' })];
  const result = mergeArticlesIntoEvents(articles, existingEvents);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'evt-existing');
  assert.equal(result[0].articleIds.length, 3);
});
