import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const serverIndex = readFileSync(resolve(ROOT, 'server/index.js'), 'utf8');

test('QA message route does not hardcode assistant replies', () => {
  assert.doesNotMatch(serverIndex, /qaLocalConversationAnswer/);
  assert.doesNotMatch(serverIndex, /localConversationAnswer/);
  assert.match(serverIndex, /import \{ qa as callAiGatewayQa \} from '\.\/ai\/gateway\.js';/);

  const routeStart = serverIndex.indexOf("POST /api/qa/conversations/:id/messages");
  assert.notEqual(routeStart, -1);
  const route = serverIndex.slice(routeStart, serverIndex.indexOf("// DELETE /api/qa/conversations/:id", routeStart));

  const readHistory = route.indexOf('const priorMessages = await readQaMessages');
  const cleanHistory = route.indexOf('const gatewayPriorMessages = priorMessages.filter');
  const gatewayCall = route.indexOf('callAiGatewayQa({');
  const appendAssistant = route.indexOf('assistantMessage = await appendQaMessage');

  assert.ok(readHistory > -1, 'route should still read recent history for gateway context');
  assert.ok(cleanHistory > readHistory, 'route should strip the just-persisted user turn from gateway history');
  assert.ok(gatewayCall > -1, 'route should call the AI Gateway only');
  assert.ok(gatewayCall > cleanHistory, 'route should call the gateway with cleaned prior history');
  assert.match(route, /priorMessages:\s*gatewayPriorMessages/);
  assert.ok(appendAssistant > gatewayCall, 'assistant message should be persisted only after gateway response');
  assert.doesNotMatch(route, /qaRetrieveTopK|qaGenerateAnswer|qaShouldBypassCorpusRetrieval|localConversationAnswer/);
  assert.match(route, /requestId/);
  assert.match(route, /content: result\.answer/);
  assert.match(route, /citations: result\.citations/);
  assert.match(route, /reasoning: result\.reasoning/);
  assert.match(route, /tokensIn: result\.tokensIn/);
  assert.match(route, /tokensOut: result\.tokensOut/);
  assert.doesNotMatch(route, /modelUsed: 'retrieval-error'/);
  assert.doesNotMatch(route, /I couldn't find enough Mapr corpus evidence/);
  assert.doesNotMatch(route, /I couldn't search the Mapr corpus/);
  assert.match(route, /sendJson\(response, 200, \{/);
});
