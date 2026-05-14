import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../server/ai/homePc.js';

test('summarizeHttpErrorBody hides upstream HTML error pages', () => {
  const html = '<!DOCTYPE html><html><body><h1>504 Gateway Timeout</h1><p>Cloudflare</p></body></html>';
  assert.equal(__test__.summarizeHttpErrorBody(html), 'upstream returned an HTML error page');
});

test('summarizeHttpErrorBody keeps concise JSON/text errors', () => {
  assert.equal(
    __test__.summarizeHttpErrorBody('{"detail":"ollama timeout"}'),
    '{"detail":"ollama timeout"}',
  );
  assert.equal(
    __test__.summarizeHttpErrorBody('<p>temporary timeout</p>'),
    'temporary timeout',
  );
});
