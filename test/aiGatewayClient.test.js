import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../server/ai/gateway.js';

test('AI gateway client accepts explicit gateway env vars first', () => {
  const config = __test__.resolveGatewayConfig({
    MAPR_AI_GATEWAY_URL: 'https://gateway.example.test///',
    MAPR_AI_GATEWAY_TOKEN: 'gateway-token',
    MAPR_AI_HOMEPC_LLM_URL: 'https://legacy.example.test',
    MAPR_AI_HOMEPC_BEARER: 'legacy-token',
  });

  assert.equal(config.url, 'https://gateway.example.test');
  assert.equal(config.token, 'gateway-token');
});

test('AI gateway client falls back to legacy home-pc env vars', () => {
  const config = __test__.resolveGatewayConfig({
    MAPR_AI_HOMEPC_LLM_URL: 'https://ai-llm.example.test/',
    MAPR_AI_HOMEPC_BEARER: 'legacy-token',
  });

  assert.equal(config.url, 'https://ai-llm.example.test');
  assert.equal(config.token, 'legacy-token');
});
