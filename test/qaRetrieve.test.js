import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../server/qa/retrieve.js';

const { vectorLiteral, buildExcerpt } = __test__;

test('vectorLiteral formats floats as pgvector textual literal', () => {
  const lit = vectorLiteral([1, -2, 0.5]);
  assert.equal(lit, '[1.000000,-2.000000,0.500000]');
});

test('vectorLiteral rejects empty vectors', () => {
  assert.throws(() => vectorLiteral([]), /empty embedding/);
});

test('buildExcerpt prefers payload.summary, falls back to title', () => {
  const withSummary = { title: 'T', payload: JSON.stringify({ summary: 'S' }) };
  assert.equal(buildExcerpt(withSummary), 'S');

  const noSummary = { title: 'Headline only', payload: '{}' };
  assert.equal(buildExcerpt(noSummary), 'Headline only');

  const longSummary = {
    title: 'T',
    payload: JSON.stringify({ summary: 'x'.repeat(500) }),
  };
  assert.equal(buildExcerpt(longSummary).length, 280);
});

test('buildExcerpt tolerates malformed payload', () => {
  assert.equal(buildExcerpt({ title: 'fall back', payload: 'not-json' }), 'fall back');
});
