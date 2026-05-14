import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../server/qa/retrieve.js';

const {
  vectorLiteral,
  buildExcerpt,
  buildSearchTerms,
  isMissingEmbeddingColumnError,
  mergeRetrieved,
} = __test__;

test('vectorLiteral formats floats as pgvector textual literal', () => {
  const lit = vectorLiteral([1, -2, 0.5]);
  assert.equal(lit, '[1.000000,-2.000000,0.500000]');
});

test('vectorLiteral rejects empty vectors', () => {
  assert.throws(() => vectorLiteral([]), /empty embedding/);
});

test('vectorLiteral rejects non-finite vector values', () => {
  assert.throws(() => vectorLiteral([1, Number.NaN]), /non-finite embedding/);
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
  assert.equal(buildExcerpt(longSummary).length, 360);
});

test('buildExcerpt tolerates malformed payload', () => {
  assert.equal(buildExcerpt({ title: 'fall back', payload: 'not-json' }), 'fall back');
});

test('buildExcerpt strips html and uses description/content fallback', () => {
  const row = {
    title: 'fallback',
    payload: JSON.stringify({ description: '<p>Yemen &amp; Red Sea update</p>' }),
  };
  assert.equal(buildExcerpt(row), 'Yemen & Red Sea update');
});

test('buildSearchTerms removes generic query words and dedupes', () => {
  assert.deepEqual(
    buildSearchTerms('What is the latest latest Yemen Red Sea report?'),
    ['yemen', 'red', 'sea'],
  );
});

test('mergeRetrieved preserves semantic order and marks duplicate lexical hits as hybrid', () => {
  const semantic = [
    { articleId: 'a', retrievalMode: 'semantic', similarity: 0.9 },
    { articleId: 'b', retrievalMode: 'semantic', similarity: 0.8 },
  ];
  const lexical = [
    { articleId: 'a', retrievalMode: 'lexical', lexicalScore: 7 },
    { articleId: 'c', retrievalMode: 'lexical', lexicalScore: 4 },
  ];
  const out = mergeRetrieved(semantic, lexical, 3);
  assert.deepEqual(out.map((r) => r.articleId), ['a', 'b', 'c']);
  assert.equal(out[0].retrievalMode, 'hybrid');
  assert.equal(out[0].lexicalScore, 7);
});

test('isMissingEmbeddingColumnError detects Postgres undefined-column embedding errors', () => {
  assert.equal(
    isMissingEmbeddingColumnError({ code: '42703', message: 'column a.embedding does not exist' }),
    true,
  );
  assert.equal(
    isMissingEmbeddingColumnError({ code: '42P01', message: 'relation articles does not exist' }),
    false,
  );
});
