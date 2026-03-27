import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Tests for API error handling and resilience patterns.
 *
 * These tests verify the server code structure rather than starting the server,
 * since the server requires database connections and external services.
 * Integration tests (curl-based) are run manually as part of verification.
 */

const serverCode = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');

describe('API error handling patterns', () => {
  it('404 handler returns { error, code } format', () => {
    assert.ok(
      serverCode.includes("{ error: 'Not found', code: 'NOT_FOUND' }"),
      'Should return structured error with code for 404'
    );
  });

  it('catch block uses classifyError for proper status codes', () => {
    assert.ok(
      serverCode.includes('classifyError(error)'),
      'Should classify errors for appropriate status codes'
    );
    assert.ok(
      serverCode.includes('const { status, body } = classifyError(error)'),
      'Should destructure status and body from classifyError'
    );
  });

  it('region-briefing without iso returns 400 with error field', () => {
    const pattern = /region-briefing.*\n.*if\s*\(!iso\)\s*\{.*400.*error.*Missing iso/s;
    assert.ok(
      pattern.test(serverCode),
      'GET /api/region-briefing without iso should return 400'
    );
  });

  it('coverage-region without iso returns 400 with error field', () => {
    assert.ok(
      serverCode.includes("{ error: 'Missing iso query parameter', code: 'BAD_REQUEST' }"),
      'Should return structured 400 error for missing iso parameter'
    );
  });

  it('admin-health returns 401 with error field for bad auth', () => {
    assert.ok(
      serverCode.includes("{ error: 'Unauthorized', code: 'UNAUTHORIZED' }"),
      'Should return structured 401 error for unauthorized requests'
    );
  });

  it('API endpoints are wrapped with withTimeout', () => {
    const timeoutMatches = serverCode.match(/withTimeout\(/g);
    assert.ok(
      timeoutMatches && timeoutMatches.length >= 5,
      `Should wrap multiple async endpoints with timeout (found ${timeoutMatches?.length || 0})`
    );
  });

  it('API_TIMEOUT_MS is defined as a constant', () => {
    assert.ok(
      serverCode.includes('API_TIMEOUT_MS'),
      'Should define API timeout constant'
    );
  });

  it('refresh endpoint uses a longer timeout', () => {
    assert.ok(
      serverCode.includes('withTimeout(() => refreshSnapshot'),
      'refresh endpoint should use withTimeout'
    );
    assert.ok(
      serverCode.includes('120_000'),
      'refresh endpoint should have a longer timeout (120s)'
    );
  });

  it('classifyError maps timeout errors to 504', () => {
    assert.ok(
      serverCode.includes('REQUEST_TIMEOUT') && serverCode.includes('504'),
      'Should map timeout errors to 504'
    );
  });

  it('classifyError maps Missing/Unknown/Invalid to 400', () => {
    assert.ok(
      serverCode.includes('/^Missing\\b/i') || serverCode.includes("'Missing'"),
      'Should detect Missing error patterns'
    );
    assert.ok(
      serverCode.includes('/^Unknown region/i') || serverCode.includes("'Unknown region'"),
      'Should detect Unknown region error patterns'
    );
  });
});

describe('circuit breaker integration', () => {
  it('fetchSources.js imports circuit breaker', () => {
    const fetchSourcesCode = readFileSync(new URL('../server/pipeline/fetchSources.js', import.meta.url), 'utf8');
    assert.ok(
      fetchSourcesCode.includes('isCircuitOpen'),
      'Should import isCircuitOpen from circuitBreaker'
    );
    assert.ok(
      fetchSourcesCode.includes('recordSuccess'),
      'Should import recordSuccess from circuitBreaker'
    );
    assert.ok(
      fetchSourcesCode.includes('recordFailure'),
      'Should import recordFailure from circuitBreaker'
    );
  });

  it('fetchRssNewsDirect filters out feeds with open circuits', () => {
    const fetchSourcesCode = readFileSync(new URL('../server/pipeline/fetchSources.js', import.meta.url), 'utf8');
    assert.ok(
      fetchSourcesCode.includes('isCircuitOpen(feed.id)'),
      'Should check circuit state for each feed'
    );
    assert.ok(
      fetchSourcesCode.includes('skippedByCircuitBreaker'),
      'Should track skipped feeds'
    );
  });

  it('fetchRssFeed records success and failure in circuit breaker', () => {
    const fetchSourcesCode = readFileSync(new URL('../server/pipeline/fetchSources.js', import.meta.url), 'utf8');
    assert.ok(
      fetchSourcesCode.includes("recordFailure(feed.id)"),
      'Should record failure for failed feeds'
    );
    assert.ok(
      fetchSourcesCode.includes("recordSuccess(feed.id)"),
      'Should record success for healthy feeds'
    );
  });

  it('health endpoint includes circuit breaker summary', () => {
    assert.ok(
      serverCode.includes('getCircuitSummary'),
      'Server should import and use getCircuitSummary'
    );
    assert.ok(
      serverCode.includes('health.circuitBreaker'),
      'Health endpoint should include circuitBreaker field'
    );
  });

  it('pipeline barrel exports circuit breaker functions', () => {
    const pipelineIndex = readFileSync(new URL('../server/pipeline/index.js', import.meta.url), 'utf8');
    assert.ok(
      pipelineIndex.includes('isCircuitOpen'),
      'Pipeline index should export isCircuitOpen'
    );
    assert.ok(
      pipelineIndex.includes('getCircuitSummary'),
      'Pipeline index should export getCircuitSummary'
    );
    assert.ok(
      pipelineIndex.includes('resetAllCircuits'),
      'Pipeline index should export resetAllCircuits'
    );
  });
});
