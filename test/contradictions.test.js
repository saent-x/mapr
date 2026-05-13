import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../server/contradictions.js';

const { sourceKeyForArticle, filterToValidSources, articleHost } = __test__;

test('articleHost strips www and lowercases', () => {
  assert.equal(articleHost('https://www.bbc.com/news/1'), 'bbc.com');
  assert.equal(articleHost('not a url'), '');
});

test('sourceKeyForArticle prefers host, falls back to source name', () => {
  assert.equal(
    sourceKeyForArticle({ url: 'https://reuters.com/x', source: 'Reuters' }),
    'reuters.com',
  );
  assert.equal(
    sourceKeyForArticle({ url: '', source: 'Al Jazeera' }),
    'al-jazeera',
  );
  assert.equal(sourceKeyForArticle({}), 'unknown');
});

test('filterToValidSources drops items with <2 sources or invalid keys', () => {
  const valid = ['reuters.com', 'ap.org', 'bbc.com'];
  const raw = [
    // VALID — two sources cross-tagged
    { claim: 'Casualty count differs',
      category: 'casualties',
      supportedBy: ['reuters.com'], refutedBy: ['ap.org'],
      confidence: 'high' },
    // INVALID — only one valid source total
    { claim: 'Only one outlet',
      supportedBy: ['reuters.com'],
      refutedBy: [] },
    // INVALID — references unknown source
    { claim: 'Ghost source',
      supportedBy: ['reuters.com'],
      refutedBy: ['someinventedsource.example'] },
    // VALID — minimal default category
    { claim: 'Attribution differs',
      supportedBy: ['bbc.com'], refutedBy: ['ap.org'] },
  ];
  const out = filterToValidSources(raw, valid);
  assert.equal(out.length, 2);
  assert.equal(out[0].claim, 'Casualty count differs');
  assert.equal(out[0].category, 'casualties');
  assert.equal(out[1].category, 'other');
});

test('filterToValidSources caps at 6 entries', () => {
  const valid = ['a', 'b'];
  const raw = Array.from({ length: 10 }, (_, i) => ({
    claim: `claim ${i}`,
    supportedBy: ['a'],
    refutedBy: ['b'],
  }));
  assert.equal(filterToValidSources(raw, valid).length, 6);
});
