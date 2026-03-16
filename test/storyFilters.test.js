import test from 'node:test';
import assert from 'node:assert/strict';
import { sortStories, storyMatchesFilters } from '../src/utils/storyFilters.js';

function createStory(overrides = {}) {
  return {
    id: overrides.id || 'story-1',
    severity: overrides.severity ?? 70,
    confidence: overrides.confidence ?? 70,
    publishedAt: overrides.publishedAt || '2026-03-15T10:00:00.000Z',
    verificationStatus: overrides.verificationStatus || 'verified',
    sourceTypes: overrides.sourceTypes || ['wire'],
    sourceType: overrides.sourceType || 'wire',
    languages: overrides.languages || ['en'],
    language: overrides.language || 'en',
    geocodePrecision: overrides.geocodePrecision || 'locality',
    confidenceReasons: overrides.confidenceReasons || []
  };
}

test('storyMatchesFilters applies the location precision filter alongside existing filters', () => {
  const localityStory = createStory({ geocodePrecision: 'locality' });
  const fallbackStory = createStory({ geocodePrecision: 'source-country' });

  assert.equal(
    storyMatchesFilters(localityStory, { precisionFilter: 'locality', minSeverity: 20 }),
    true
  );
  assert.equal(
    storyMatchesFilters(fallbackStory, { precisionFilter: 'locality', minSeverity: 20 }),
    false
  );
});

test('storyMatchesFilters enforces a minimum confidence threshold', () => {
  const highConfidenceStory = createStory({ confidence: 82 });
  const lowConfidenceStory = createStory({ confidence: 41 });

  assert.equal(
    storyMatchesFilters(highConfidenceStory, { minConfidence: 60 }),
    true
  );
  assert.equal(
    storyMatchesFilters(lowConfidenceStory, { minConfidence: 60 }),
    false
  );
});

test('storyMatchesFilters strict accuracy mode excludes warning-bearing events', () => {
  const strictSafeStory = createStory({
    confidence: 78,
    geocodePrecision: 'locality'
  });
  const warningStory = createStory({
    confidence: 84,
    geocodePrecision: 'country',
    confidenceReasons: [{ type: 'conflicting-location-signals', tone: 'warning' }]
  });

  assert.equal(
    storyMatchesFilters(strictSafeStory, { accuracyMode: 'strict' }),
    true
  );
  assert.equal(
    storyMatchesFilters(warningStory, { accuracyMode: 'strict' }),
    false
  );
});

test('sortStories preserves severity-first ordering unless latest mode is requested', () => {
  const olderHigh = createStory({
    id: 'older-high',
    severity: 90,
    publishedAt: '2026-03-15T09:00:00.000Z'
  });
  const newerLower = createStory({
    id: 'newer-low',
    severity: 60,
    publishedAt: '2026-03-15T11:00:00.000Z'
  });

  assert.deepEqual(
    sortStories([newerLower, olderHigh], 'severity').map((story) => story.id),
    ['older-high', 'newer-low']
  );
  assert.deepEqual(
    sortStories([olderHigh, newerLower], 'latest').map((story) => story.id),
    ['newer-low', 'older-high']
  );
});
