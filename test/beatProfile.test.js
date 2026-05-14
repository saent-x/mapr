import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../server/beats/profile.js';

const { clampDescription, vectorLiteral, MIN_LEN } = __test__;

test('clampDescription rejects empty / short input', () => {
  assert.throws(() => clampDescription(''), /required/);
  assert.throws(() => clampDescription('x'), new RegExp(`at least ${MIN_LEN}`));
});

test('clampDescription trims + caps long input', () => {
  const long = 'I cover energy markets in eurasia ' + 'x'.repeat(5000);
  const cleaned = clampDescription(`   ${long}   `);
  assert.equal(cleaned.length, 2000);
  assert.equal(cleaned[0], 'I');
});

test('vectorLiteral formats pgvector literal with 6-decimal floats', () => {
  assert.equal(vectorLiteral([0.1, -0.2, 0]), '[0.100000,-0.200000,0.000000]');
});
