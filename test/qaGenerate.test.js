import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../server/qa/generate.js';

const { trimPriorMessages, trimRetrieved, coerceOutput, enrichCitations } = __test__;

test('trimPriorMessages caps at 6 and normalizes role', () => {
  const out = trimPriorMessages([
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'user', content: 'c' },
    { role: 'assistant', content: 'd' },
    { role: 'user', content: 'e' },
    { role: 'assistant', content: 'f' },
    { role: 'user', content: 'g' },        // 7th — should drop the oldest
  ]);
  assert.equal(out.length, 6);
  assert.equal(out[0].content, 'b');       // oldest kept
  assert.equal(out[out.length - 1].content, 'g');

  const weird = trimPriorMessages([{ role: 'system', content: 'x' }]);
  assert.equal(weird[0].role, 'user');     // unknown role normalized to user
});

test('trimRetrieved enforces excerpt cap + index numbering', () => {
  const out = trimRetrieved([
    { articleId: 'a', title: 'T', source: 'src', excerpt: 'x'.repeat(500) },
    { articleId: 'b', title: 'U', source: 'src', excerpt: 'y' },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].index, 1);
  assert.equal(out[1].index, 2);
  assert.equal(out[0].excerpt.length, 280);
});

test('coerceOutput defaults on bad input', () => {
  assert.deepEqual(coerceOutput(null), { answer: '', citations: [] });
  assert.deepEqual(coerceOutput({}), { answer: '', citations: [] });
  const out = coerceOutput({
    answer: 'hello',
    citations: [{ articleId: 'a', index: 1, quote: 'q' }, { weird: true }],
  });
  assert.equal(out.answer, 'hello');
  assert.equal(out.citations.length, 1);
  assert.equal(out.citations[0].articleId, 'a');
});

test('enrichCitations drops unknown articleIds, attaches eventId', () => {
  const retrieved = [
    { articleId: 'a1', eventId: 'e1', title: 'T1', source: 's1', url: 'http://x/1' },
    { articleId: 'a2', eventId: null, title: 'T2', source: 's2', url: 'http://x/2' },
  ];
  const cites = [
    { index: 1, articleId: 'a1', quote: 'q' },
    { index: 2, articleId: 'a2' },
    { index: 3, articleId: 'ghost' },         // not in retrieved
  ];
  const out = enrichCitations(cites, retrieved);
  assert.equal(out.length, 2);
  assert.equal(out[0].eventId, 'e1');
  assert.equal(out[1].eventId, null);
  assert.equal(out[0].quote, 'q');
});
