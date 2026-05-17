import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

function read(path) {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

test('agent chat uses local prompt-kit primitives for messages, input, sources, loader, and reasoning', () => {
  const list = read('src/components/agent/AgentMessageList.jsx');
  const composer = read('src/components/agent/AgentComposer.jsx');

  assert.match(list, /prompt-kit\/message/);
  assert.match(list, /prompt-kit\/reasoning/);
  assert.match(list, /prompt-kit\/source/);
  assert.match(list, /prompt-kit\/loader/);
  assert.match(list, /prompt-kit\/response/);
  assert.match(list, /AgentReasoning/);
  assert.match(list, /m\.reasoning/);

  assert.match(composer, /prompt-kit\/prompt-input/);
  assert.match(composer, /PromptInputTextarea/);
  assert.match(composer, /PromptInputAction/);
});

test('agent reasoning is persisted as assistant metadata, not mixed into answer text', () => {
  const schema = read('instant.schema.ts');
  const conversations = read('server/qa/conversations.js');
  const route = read('server/index.js');

  assert.match(schema, /reasoning:\s*i\.json\(\)\.optional\(\)/);
  assert.match(conversations, /reasoning\s*=\s*null/);
  assert.match(conversations, /messageRec\.reasoning\s*=\s*reasoning/);
  assert.match(conversations, /reasoning:\s*row\.reasoning\s*\|\|\s*null/);
  assert.match(route, /reasoning:\s*result\.reasoning/);
});

test('AI gateway response exposes a separate reasoning object for the UI', () => {
  const mainPy = read('home-pc/app/main.py');

  assert.match(mainPy, /class QaGatewayReasoning\(BaseModel\)/);
  assert.match(mainPy, /reasoning:\s*QaGatewayReasoning/);
  assert.match(mainPy, /_build_reasoning_trace\(/);
});
