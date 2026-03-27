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

test('source catalog contains 200+ total sources (VAL-DATA-001)', () => {
  const catalog = getDefaultSourceCatalog();
  assert(catalog.length >= 200, `Expected 200+ sources, got ${catalog.length}`);
  const enabled = catalog.filter((e) => e.enabled);
  assert(enabled.length >= 180, `Expected 180+ enabled sources, got ${enabled.length}`);
});

test('source catalog has 25+ feeds covering Asian countries including Central Asia (VAL-DATA-003)', () => {
  const catalog = getDefaultSourceCatalog();
  const asianISOs = new Set(['AF','BD','BN','BT','KH','CN','IN','ID','JP','KZ','KG','LA','MY','MV','MN','MM','NP','KP','PK','PH','SG','KR','LK','TW','TJ','TH','TL','TM','UZ','VN']);
  const asianFeeds = catalog.filter((e) => {
    if (asianISOs.has(e.isoA2)) return true;
    if (e.coverageIsoA2s?.some((iso) => asianISOs.has(iso))) return true;
    return false;
  });
  assert(asianFeeds.length >= 25, `Expected 25+ Asian feeds, got ${asianFeeds.length}`);

  // Verify Central Asia coverage
  const centralAsiaISOs = new Set(['UZ', 'TM', 'TJ', 'KG', 'MN']);
  const centralAsiaFeeds = asianFeeds.filter((e) =>
    centralAsiaISOs.has(e.isoA2) || e.coverageIsoA2s?.some((iso) => centralAsiaISOs.has(iso))
  );
  assert(centralAsiaFeeds.length >= 3, `Expected 3+ Central Asia feeds, got ${centralAsiaFeeds.length}`);
});

test('source catalog has 15+ feeds covering Americas beyond existing major countries (VAL-DATA-004)', () => {
  const catalog = getDefaultSourceCatalog();
  const americasISOs = new Set(['AR','BS','BB','BZ','BO','BR','CA','CL','CO','CR','CU','DO','EC','SV','GT','GY','HT','HN','JM','MX','NI','PA','PY','PE','SR','TT','UY','VE']);
  const americasFeeds = catalog.filter((e) => {
    if (americasISOs.has(e.isoA2)) return true;
    if (e.coverageIsoA2s?.some((iso) => americasISOs.has(iso))) return true;
    return false;
  });
  assert(americasFeeds.length >= 15, `Expected 15+ Americas feeds, got ${americasFeeds.length}`);

  // Verify Caribbean/Central America coverage
  const caribbeanISOs = new Set(['TT', 'BS', 'BB', 'GY', 'SR', 'BZ']);
  const caribbeanFeeds = americasFeeds.filter((e) =>
    caribbeanISOs.has(e.isoA2) || e.coverageIsoA2s?.some((iso) => caribbeanISOs.has(iso))
  );
  assert(caribbeanFeeds.length >= 3, `Expected 3+ Caribbean feeds, got ${caribbeanFeeds.length}`);
});

test('new RSS feeds have proper metadata fields', () => {
  const catalog = getDefaultSourceCatalog();
  const rssFeeds = catalog.filter((e) => e.fetchMode === 'rss' && !e.candidate);

  for (const feed of rssFeeds) {
    assert(feed.id, `Feed missing id: ${feed.name}`);
    assert(feed.name, `Feed missing name: ${feed.id}`);
    assert(feed.url, `Feed missing url: ${feed.id}`);
    assert(typeof feed.enabled === 'boolean', `Feed ${feed.id} enabled should be boolean`);
  }
});

test('source catalog covers Oceania Pacific island nations', () => {
  const catalog = getDefaultSourceCatalog();
  const pacificISOs = new Set(['WS', 'TO', 'SB', 'VU']);
  const pacificFeeds = catalog.filter((e) =>
    pacificISOs.has(e.isoA2) || e.coverageIsoA2s?.some((iso) => pacificISOs.has(iso))
  );
  assert(pacificFeeds.length >= 2, `Expected 2+ Pacific island feeds, got ${pacificFeeds.length}`);
});

test('source catalog has 5+ enabled HTML sources (VAL-DATA-006)', () => {
  const catalog = getDefaultSourceCatalog();
  const htmlSources = catalog.filter((e) => e.fetchMode === 'html' && e.enabled);
  assert(htmlSources.length >= 5, `Expected 5+ enabled HTML sources, got ${htmlSources.length}`);

  // Verify HTML sources have required fields
  for (const source of htmlSources.slice(0, 10)) {
    assert(source.id, `HTML source missing id: ${source.name}`);
    assert(source.name, `HTML source missing name: ${source.id}`);
    assert(source.url, `HTML source missing url: ${source.id}`);
    assert.equal(source.fetchMode, 'html');
    assert.equal(source.enabled, true);
  }
});

test('source catalog includes HTML sources from underrepresented regions', () => {
  const catalog = getDefaultSourceCatalog();
  const htmlSources = catalog.filter((e) => e.fetchMode === 'html' && e.enabled);

  // Check for specific underrepresented regions with HTML sources
  const targetISOs = new Set(['MM', 'KH', 'TJ', 'CM', 'SN', 'MZ', 'HT', 'PG']);
  const underrepResources = htmlSources.filter((e) => targetISOs.has(e.isoA2));
  assert(underrepResources.length >= 5, `Expected 5+ HTML sources from underrepresented regions (MM, KH, TJ, CM, SN, MZ, HT, PG), got ${underrepResources.length}`);
});

test('source catalog covers Eastern European countries', () => {
  const catalog = getDefaultSourceCatalog();
  const eeISOs = new Set(['BY', 'MD', 'MK', 'XK', 'LV', 'LT', 'EE']);
  const eeFeeds = catalog.filter((e) =>
    eeISOs.has(e.isoA2) || e.coverageIsoA2s?.some((iso) => eeISOs.has(iso))
  );
  assert(eeFeeds.length >= 5, `Expected 5+ Eastern Europe feeds, got ${eeFeeds.length}`);
});
