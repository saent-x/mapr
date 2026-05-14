import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const serverIndex = readFileSync(resolve(ROOT, 'server/index.js'), 'utf8');

test('QA message route does not hardcode assistant replies', () => {
  assert.doesNotMatch(serverIndex, /qaLocalConversationAnswer/);
  assert.doesNotMatch(serverIndex, /localConversationAnswer/);
  assert.match(serverIndex, /shouldBypassCorpusRetrieval as qaShouldBypassCorpusRetrieval/);

  const routeStart = serverIndex.indexOf("POST /api/qa/conversations/:id/messages");
  assert.notEqual(routeStart, -1);
  const route = serverIndex.slice(routeStart, serverIndex.indexOf("// DELETE /api/qa/conversations/:id", routeStart));

  const readHistory = route.indexOf('const priorMessages = await readQaMessages');
  const skipRetrieval = route.indexOf('const skipRetrieval = qaShouldBypassCorpusRetrieval(content);');
  const retrievalGuard = route.indexOf('if (!skipRetrieval)');
  const retrieval = route.indexOf('retrieved = await qaRetrieveTopK');
  const retrievalFailure = route.indexOf("code: 'QA_RETRIEVAL_FAILED'");
  const generation = route.indexOf('qaGenerateAnswer({');

  assert.ok(readHistory > -1, 'route should still read history for real QA requests');
  assert.ok(skipRetrieval > -1, 'route should classify simple conversational turns');
  assert.ok(retrievalGuard > -1, 'route should skip retrieval for simple conversational turns');
  assert.ok(retrieval > -1, 'route should still retrieve corpus evidence for real QA requests');
  assert.ok(retrievalFailure > -1, 'route should return a structured retrieval error');
  assert.ok(generation > -1, 'route should still call the generator for real QA requests');
  assert.ok(skipRetrieval < retrieval, 'retrieval bypass check should run before corpus retrieval');
  assert.ok(retrievalGuard < retrieval, 'corpus retrieval should be guarded');
  assert.ok(retrieval < retrievalFailure, 'retrieval should run before retrieval failure handling');
  assert.ok(retrievalFailure < generation, 'retrieval failure should stop before model generation');
  assert.match(route, /content: result\.answer/);
  assert.doesNotMatch(route, /modelUsed: 'retrieval-error'/);
  assert.doesNotMatch(route, /I couldn't find enough Mapr corpus evidence/);
  assert.doesNotMatch(route, /I couldn't search the Mapr corpus/);
  assert.match(route, /sendJson\(response, 200, \{/);
});
