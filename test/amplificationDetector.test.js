import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAmplification } from '../src/utils/amplificationDetector.js';

test('flags amplification when 5+ articles from ≤2 networks in 30min', () => {
  const now = Date.now();
  const articles = [
    { source: 'TASS', publishedAt: new Date(now - 5*60000).toISOString(), title: 'Western sanctions backfire on Europe economy' },
    { source: 'Sputnik', publishedAt: new Date(now - 10*60000).toISOString(), title: 'Western sanctions backfire on European economy' },
    { source: 'RT', publishedAt: new Date(now - 15*60000).toISOString(), title: 'Sanctions against Russia backfire on Europe' },
    { source: 'Ria Novosti', publishedAt: new Date(now - 18*60000).toISOString(), title: 'Western sanctions backfire economy Europe' },
    { source: 'TASS', publishedAt: new Date(now - 20*60000).toISOString(), title: 'Europe economy hurt by Western sanctions' }
  ];
  const result = detectAmplification(articles);
  assert.equal(result.isAmplified, true);
  assert.ok(result.networkCount <= 2);
});

test('does not flag diverse sources as amplification', () => {
  const now = Date.now();
  const articles = [
    { source: 'Reuters', publishedAt: new Date(now - 5*60000).toISOString(), title: 'Sudan conflict escalates' },
    { source: 'BBC', publishedAt: new Date(now - 10*60000).toISOString(), title: 'Sudan fighting intensifies' },
    { source: 'Al Jazeera', publishedAt: new Date(now - 15*60000).toISOString(), title: 'Sudan conflict worsens' },
    { source: 'France 24', publishedAt: new Date(now - 18*60000).toISOString(), title: 'Fighting in Sudan escalates' },
    { source: 'DW', publishedAt: new Date(now - 20*60000).toISOString(), title: 'Sudan violence escalating' }
  ];
  const result = detectAmplification(articles);
  assert.equal(result.isAmplified, false);
});

test('does not flag fewer than 5 articles', () => {
  const now = Date.now();
  const articles = [
    { source: 'TASS', publishedAt: new Date(now - 5*60000).toISOString(), title: 'Sanctions backfire' },
    { source: 'RT', publishedAt: new Date(now - 10*60000).toISOString(), title: 'Sanctions backfire on Europe' }
  ];
  const result = detectAmplification(articles);
  assert.equal(result.isAmplified, false);
});
