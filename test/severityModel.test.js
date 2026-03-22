import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCompositeSeverity } from '../src/utils/severityModel.js';

test('keyword-only article gets baseline severity', () => {
  const score = computeCompositeSeverity({
    keywordSeverity: 85,
    articleCount: 1,
    diversityScore: 0,
    entities: { organizations: [], people: [] },
    category: 'Seismic'
  });
  assert.ok(score >= 25 && score <= 50);
});

test('multi-source diverse event scores higher than single source with crisis keyword', () => {
  const singleSource = computeCompositeSeverity({
    keywordSeverity: 85,
    articleCount: 1,
    diversityScore: 0,
    entities: { organizations: [], people: [] },
    category: 'General'
  });
  const multiSource = computeCompositeSeverity({
    keywordSeverity: 40,
    articleCount: 8,
    diversityScore: 0.8,
    entities: { organizations: [], people: [] },
    category: 'Conflict'
  });
  assert.ok(multiSource > singleSource);
});

test('military entity boosts severity', () => {
  const withEntity = computeCompositeSeverity({
    keywordSeverity: 50,
    articleCount: 3,
    diversityScore: 0.5,
    entities: { organizations: [{ name: 'Wagner Group', type: 'military' }], people: [] },
    category: 'Conflict'
  });
  const without = computeCompositeSeverity({
    keywordSeverity: 50,
    articleCount: 3,
    diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Conflict'
  });
  assert.ok(withEntity > without);
});

test('conflict/disaster categories score higher than political/economic', () => {
  const conflict = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] }, category: 'Conflict'
  });
  const economic = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] }, category: 'Economic'
  });
  assert.ok(conflict > economic);
});

test('NER categories also work (lowercase)', () => {
  const disaster = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] }, category: 'disaster'
  });
  const economic = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] }, category: 'economic'
  });
  assert.ok(disaster > economic);
});

test('returns clamped 0-100 range', () => {
  const low = computeCompositeSeverity({
    keywordSeverity: 0, articleCount: 1, diversityScore: 0,
    entities: { organizations: [], people: [] }, category: 'General'
  });
  const high = computeCompositeSeverity({
    keywordSeverity: 100, articleCount: 50, diversityScore: 1,
    entities: { organizations: [{ type: 'military' }, { type: 'military' }], people: [] },
    category: 'Conflict'
  });
  assert.ok(low >= 0 && low <= 100);
  assert.ok(high >= 0 && high <= 100);
});
