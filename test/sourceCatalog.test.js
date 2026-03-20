import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultSourceCatalog, mergeSourceState, selectSourcesForRun } from '../server/sourceCatalog.js';

test('selectSourcesForRun includes never-checked and overdue sources while skipping disabled and not-yet-due sources', () => {
  const catalog = [
    { id: 'wire-a', name: 'Wire A', url: 'https://a.example/rss', enabled: true, cadenceMinutes: 30, priority: 1, seedIndex: 0 },
    { id: 'local-b', name: 'Local B', url: 'https://b.example/rss', enabled: true, cadenceMinutes: 60, priority: 2, seedIndex: 1 },
    { id: 'regional-c', name: 'Regional C', url: 'https://c.example/rss', enabled: false, cadenceMinutes: 45, priority: 3, seedIndex: 2 }
  ];
  const now = Date.now();
  const sourceState = {
    'wire-a': {
      lastCheckedAt: new Date(now - 31 * 60_000).toISOString(),
      nextCheckAt: new Date(now - 60_000).toISOString()
    },
    'local-b': {
      lastCheckedAt: new Date(now - 10 * 60_000).toISOString(),
      nextCheckAt: new Date(now + 50 * 60_000).toISOString()
    }
  };

  const selected = selectSourcesForRun(catalog, sourceState).map((entry) => entry.id);

  assert.deepEqual(selected, ['wire-a']);
});

test('mergeSourceState updates checked feeds and preserves unchecked feed timing', () => {
  const checkedAt = '2026-03-19T20:00:00.000Z';
  const catalog = [
    { id: 'wire-a', cadenceMinutes: 30 },
    { id: 'local-b', cadenceMinutes: 60 }
  ];
  const previousState = {
    'local-b': {
      lastCheckedAt: '2026-03-19T19:00:00.000Z',
      lastSuccessAt: '2026-03-19T19:00:00.000Z',
      lastStatus: 'ok',
      lastError: null,
      lastArticleCount: 12,
      nextCheckAt: '2026-03-19T20:00:00.000Z'
    }
  };
  const nextState = mergeSourceState(catalog, previousState, [
    {
      feedId: 'wire-a',
      status: 'ok',
      articleCount: 7,
      error: null
    }
  ], checkedAt);

  assert.equal(nextState['wire-a'].lastCheckedAt, checkedAt);
  assert.equal(nextState['wire-a'].lastSuccessAt, checkedAt);
  assert.equal(nextState['wire-a'].lastStatus, 'ok');
  assert.equal(nextState['wire-a'].lastArticleCount, 7);
  assert.equal(nextState['wire-a'].nextCheckAt, '2026-03-19T20:30:00.000Z');
  assert.equal(nextState['local-b'].lastCheckedAt, '2026-03-19T19:00:00.000Z');
  assert.equal(nextState['local-b'].nextCheckAt, '2026-03-19T20:00:00.000Z');
});

test('selectSourcesForRun includes html sources when they are enabled and due', () => {
  const catalog = [
    { id: 'html-a', name: 'HTML A', url: 'https://a.example', enabled: true, fetchMode: 'html', cadenceMinutes: 30, priority: 1, seedIndex: 0 },
    { id: 'rss-b', name: 'RSS B', url: 'https://b.example/rss', enabled: true, fetchMode: 'rss', cadenceMinutes: 30, priority: 2, seedIndex: 1 }
  ];

  const selected = selectSourcesForRun(catalog, {}).map((entry) => entry.id);

  assert.deepEqual(selected, ['html-a', 'rss-b']);
});

test('getDefaultSourceCatalog includes bundled candidate sources', () => {
  const catalog = getDefaultSourceCatalog();
  const candidate = catalog.find((entry) => entry.country === 'Burundi' && entry.fetchMode === 'html');

  assert(candidate);
  assert.equal(candidate.enabled, true);
  assert.equal(candidate.candidate, true);
  assert.equal(candidate.cadenceMinutes, 240);
});
