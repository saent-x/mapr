import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

test('AgentMessageList displays structured backend error details', () => {
  const source = readFileSync(resolve(ROOT, 'src/components/agent/AgentMessageList.jsx'), 'utf8');

  assert.match(source, /function formatAgentError\(error, t\)/);
  assert.match(source, /error\?\.payload\?\.code/);
  assert.match(source, /error\?\.payload\?\.error/);
  assert.match(source, /\$\{code\}: \$\{message\}/);
  assert.match(source, /formatAgentError\(error, t\)/);
});
