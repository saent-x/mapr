import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeArticlesIntoEvents, computeEntityOverlap } from '../server/eventStore.js';

function makeArticle(overrides = {}) {
  return {
    id: `art-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Turkey earthquake kills hundreds',
    url: `https://example.com/${Math.random().toString(36).slice(2)}`,
    source: 'reuters',
    publishedAt: new Date().toISOString(),
    isoA2: 'TR',
    region: 'Turkey',
    severity: 80,
    category: 'Seismic',
    geocodePrecision: 'country',
    coordinates: [39.0, 35.0],
    entities: { people: [], organizations: [], locations: [] },
    ...overrides
  };
}

// ── Entity overlap scoring tests ────────────────────────────────────────────

test('computeEntityOverlap returns 0 for no shared entities', () => {
  const articleEntities = {
    people: [{ name: 'John Smith' }],
    organizations: [{ name: 'NATO' }]
  };
  const eventEntities = {
    people: [{ name: 'Jane Doe' }],
    organizations: [{ name: 'United Nations' }]
  };
  assert.equal(computeEntityOverlap(articleEntities, eventEntities), 0);
});

test('computeEntityOverlap returns positive score for shared people', () => {
  const articleEntities = {
    people: [{ name: 'Vladimir Putin' }],
    organizations: []
  };
  const eventEntities = {
    people: [{ name: 'Vladimir Putin' }, { name: 'Joe Biden' }],
    organizations: [{ name: 'NATO' }]
  };
  const score = computeEntityOverlap(articleEntities, eventEntities);
  assert.ok(score > 0, `Expected positive score, got ${score}`);
});

test('computeEntityOverlap returns positive score for shared organizations', () => {
  const articleEntities = {
    people: [],
    organizations: [{ name: 'NATO' }]
  };
  const eventEntities = {
    people: [],
    organizations: [{ name: 'NATO' }, { name: 'EU' }]
  };
  const score = computeEntityOverlap(articleEntities, eventEntities);
  assert.ok(score > 0, `Expected positive score, got ${score}`);
});

test('computeEntityOverlap handles empty/missing entities gracefully', () => {
  assert.equal(computeEntityOverlap(null, null), 0);
  assert.equal(computeEntityOverlap({}, {}), 0);
  assert.equal(computeEntityOverlap({ people: [], organizations: [] }, null), 0);
});

// ── Entity overlap contributes to event correlation ─────────────────────────

test('mergeArticlesIntoEvents groups articles with shared entities within 24h', () => {
  const now = new Date();
  const articles = [
    makeArticle({
      title: 'President meets opposition leader in talks',
      isoA2: 'SD',
      publishedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      entities: {
        people: [{ name: 'Omar Hassan' }],
        organizations: [{ name: 'Rapid Support Forces' }],
        locations: []
      }
    }),
    makeArticle({
      title: 'Military negotiations continue in Khartoum',
      isoA2: 'SD',
      publishedAt: new Date(now - 1 * 60 * 60 * 1000).toISOString(),
      entities: {
        people: [{ name: 'Omar Hassan' }],
        organizations: [{ name: 'Sudanese Armed Forces' }],
        locations: [{ name: 'Khartoum' }]
      }
    })
  ];
  // These have different titles but share the person "Omar Hassan" and same country
  const result = mergeArticlesIntoEvents(articles, []);
  assert.ok(result.length <= 2, `Expected <= 2 events but got ${result.length}`);
  // At least one event should have > 1 articles if entity overlap works
  const multiArticleEvents = result.filter(e => e.articleIds.length > 1);
  assert.ok(multiArticleEvents.length >= 1,
    'Expected entity overlap to group articles mentioning same person');
});

test('mergeArticlesIntoEvents does not group articles with different entities and different topics', () => {
  const now = new Date();
  const articles = [
    makeArticle({
      title: 'President meets opposition leader in talks',
      isoA2: 'SD',
      publishedAt: new Date(now - 1 * 60 * 60 * 1000).toISOString(),
      entities: {
        people: [{ name: 'Person A' }],
        organizations: [{ name: 'Org X' }],
        locations: []
      }
    }),
    makeArticle({
      title: 'Earthquake strikes coastal region causing damage',
      isoA2: 'SD',
      publishedAt: now.toISOString(),
      entities: {
        people: [{ name: 'Person B' }],
        organizations: [{ name: 'Org Y' }],
        locations: []
      }
    })
  ];
  const result = mergeArticlesIntoEvents(articles, []);
  assert.equal(result.length, 2,
    'Articles with different entities and different topics should be separate events');
});

test('mergeArticlesIntoEvents groups articles mentioning same organization within 24h window', () => {
  const now = new Date();
  const articles = [
    makeArticle({
      title: 'ECOWAS imposes sanctions on military junta',
      isoA2: 'NE',
      publishedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      entities: {
        people: [],
        organizations: [{ name: 'ECOWAS' }],
        locations: []
      }
    }),
    makeArticle({
      title: 'West African bloc threatens intervention amid crisis',
      isoA2: 'NE',
      publishedAt: new Date(now - 1 * 60 * 60 * 1000).toISOString(),
      entities: {
        people: [],
        organizations: [{ name: 'ECOWAS' }],
        locations: []
      }
    })
  ];
  const result = mergeArticlesIntoEvents(articles, []);
  const multiArticleEvents = result.filter(e => e.articleIds.length > 1);
  assert.ok(multiArticleEvents.length >= 1,
    'Articles sharing the same organization should be grouped');
});

// ── Temporal proximity test ─────────────────────────────────────────────────

test('mergeArticlesIntoEvents prefers recent events for matching', () => {
  const now = new Date();
  const existingEvents = [{
    id: 'evt-recent',
    title: 'Sudan conflict escalates',
    primaryCountry: 'SD',
    countries: ['SD'],
    lifecycle: 'developing',
    severity: 75,
    category: 'Conflict',
    firstSeenAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
    lastUpdatedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    topicFingerprint: ['conflict', 'escalates', 'sudan'],
    articleIds: ['art-prev1'],
    entities: {
      people: [{ name: 'Omar Hassan', mentionCount: 1 }],
      organizations: [{ name: 'RSF', mentionCount: 1 }],
      locations: []
    }
  }];
  const articles = [
    makeArticle({
      title: 'Conflict continues in Sudan region',
      isoA2: 'SD',
      publishedAt: new Date(now - 1 * 60 * 60 * 1000).toISOString(),
      entities: {
        people: [{ name: 'Omar Hassan' }],
        organizations: [{ name: 'RSF' }],
        locations: []
      }
    })
  ];
  const result = mergeArticlesIntoEvents(articles, existingEvents);
  const existingEvt = result.find(e => e.id === 'evt-recent');
  assert.ok(existingEvt, 'Should match existing event');
  assert.equal(existingEvt.articleIds.length, 2,
    'Should merge into the recent existing event');
});

// ── Events have populated entities arrays ───────────────────────────────────

test('new events created by mergeArticlesIntoEvents include entities from articles', () => {
  const articles = [
    makeArticle({
      title: 'NATO launches military exercise near border',
      entities: {
        people: [{ name: 'Jens Stoltenberg' }],
        organizations: [{ name: 'NATO' }],
        locations: [{ name: 'Poland' }]
      }
    })
  ];
  const result = mergeArticlesIntoEvents(articles, []);
  assert.equal(result.length, 1);
  const event = result[0];
  assert.ok(event.entities, 'Event should have entities');
  assert.ok(event.entities.people.length > 0, 'Event should have people entities');
  assert.ok(event.entities.organizations.length > 0, 'Event should have organization entities');
});

test('merged events accumulate entities from multiple articles', () => {
  const articles = [
    makeArticle({
      title: 'Turkey earthquake kills hundreds in southern region',
      entities: {
        people: [{ name: 'Erdogan' }],
        organizations: [{ name: 'Red Cross' }],
        locations: [{ name: 'Turkey' }]
      }
    }),
    makeArticle({
      title: 'Earthquake in Turkey leaves hundreds dead',
      entities: {
        people: [{ name: 'WHO Director' }],
        organizations: [{ name: 'WHO' }, { name: 'Red Cross' }],
        locations: [{ name: 'Ankara' }]
      }
    })
  ];
  const result = mergeArticlesIntoEvents(articles, []);
  assert.equal(result.length, 1, 'Similar articles should merge');
  const event = result[0];
  assert.ok(event.entities, 'Event should have entities');
  assert.ok(event.entities.organizations.length >= 2,
    'Event should accumulate orgs from multiple articles');
});

// ── correlationBuilder utility tests ────────────────────────────────────────

import {
  collectEntityNames,
  eventsOverlap,
  sharedEntities,
  eventContainsEntity,
  buildCorrelationData,
  buildCorrelationInsights,
  severityColor,
} from '../src/utils/correlationBuilder.js';

function makeEvent(overrides = {}) {
  const now = Date.now();
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test Event',
    primaryCountry: 'US',
    severity: 50,
    firstSeenAt: new Date(now).toISOString(),
    entities: { people: [], organizations: [], locations: [] },
    ...overrides
  };
}

test('collectEntityNames collects all entity names lowercased', () => {
  const entities = {
    people: [{ name: 'John Smith' }, { name: 'Jane Doe' }],
    organizations: [{ name: 'NATO' }],
    locations: [{ name: 'Kyiv' }, { name: 'Brussels' }]
  };
  const names = collectEntityNames(entities);
  assert.equal(names.size, 5);
  assert.ok(names.has('john smith'));
  assert.ok(names.has('nato'));
  assert.ok(names.has('kyiv'));
});

test('collectEntityNames handles null/empty entities', () => {
  assert.equal(collectEntityNames(null).size, 0);
  assert.equal(collectEntityNames({}).size, 0);
  assert.equal(collectEntityNames({ people: [], organizations: [], locations: [] }).size, 0);
});

test('eventsOverlap returns true when events share an entity', () => {
  const a = { people: [{ name: 'Putin' }], organizations: [], locations: [] };
  const b = { people: [{ name: 'Putin' }], organizations: [{ name: 'NATO' }], locations: [] };
  assert.ok(eventsOverlap(a, b));
});

test('eventsOverlap returns false when no shared entities', () => {
  const a = { people: [{ name: 'Alice' }], organizations: [], locations: [] };
  const b = { people: [{ name: 'Bob' }], organizations: [{ name: 'Org X' }], locations: [] };
  assert.ok(!eventsOverlap(a, b));
});

test('eventsOverlap handles null gracefully', () => {
  assert.ok(!eventsOverlap(null, null));
  assert.ok(!eventsOverlap({}, null));
  assert.ok(!eventsOverlap({ people: [{ name: 'X' }] }, null));
});

test('sharedEntities returns shared entity names', () => {
  const a = { people: [{ name: 'Putin' }, { name: 'Biden' }], organizations: [{ name: 'NATO' }], locations: [] };
  const b = { people: [{ name: 'Putin' }], organizations: [{ name: 'NATO' }, { name: 'EU' }], locations: [] };
  const shared = sharedEntities(a, b);
  assert.equal(shared.length, 2);
  assert.ok(shared.includes('putin'));
  assert.ok(shared.includes('nato'));
});

test('eventContainsEntity finds matching entity', () => {
  const entities = {
    people: [{ name: 'Vladimir Putin' }],
    organizations: [{ name: 'United Nations' }],
    locations: [{ name: 'Kyiv' }]
  };
  assert.ok(eventContainsEntity(entities, 'putin'));
  assert.ok(eventContainsEntity(entities, 'united'));
  assert.ok(eventContainsEntity(entities, 'kyiv'));
  assert.ok(!eventContainsEntity(entities, 'zelensky'));
});

test('buildCorrelationData groups events into region lanes', () => {
  const now = Date.now();
  const events = [
    makeEvent({ primaryCountry: 'UA', firstSeenAt: new Date(now - 3600000).toISOString() }),
    makeEvent({ primaryCountry: 'UA', firstSeenAt: new Date(now - 7200000).toISOString() }),
    makeEvent({ primaryCountry: 'SY', firstSeenAt: new Date(now - 10800000).toISOString() }),
    makeEvent({ primaryCountry: 'SY', firstSeenAt: new Date(now - 14400000).toISOString() }),
  ];
  const { lanes } = buildCorrelationData(events);
  // Should have 2 lanes (UA, SY)
  const regions = lanes.map(l => l.region);
  assert.ok(regions.includes('UA'));
  assert.ok(regions.includes('SY'));
  // UA lane should have 2 events, SY lane should have 2 events
  const uaLane = lanes.find(l => l.region === 'UA');
  const syLane = lanes.find(l => l.region === 'SY');
  assert.equal(uaLane.events.length, 2);
  assert.equal(syLane.events.length, 2);
});

test('buildCorrelationData creates cross-lane lines for shared entities', () => {
  const now = Date.now();
  const events = [
    makeEvent({
      id: 'evt-ua',
      primaryCountry: 'UA',
      firstSeenAt: new Date(now - 3600000).toISOString(),
      entities: { people: [{ name: 'Putin' }], organizations: [{ name: 'NATO' }], locations: [] }
    }),
    makeEvent({
      id: 'evt-us',
      primaryCountry: 'US',
      firstSeenAt: new Date(now - 7200000).toISOString(),
      entities: { people: [{ name: 'Putin' }], organizations: [], locations: [] }
    }),
  ];
  const { correlations } = buildCorrelationData(events);
  assert.ok(correlations.length >= 1, 'Should have at least 1 correlation line');
  const hasCrossLink = correlations.some(
    c => (c.from === 'evt-ua' && c.to === 'evt-us') || (c.from === 'evt-us' && c.to === 'evt-ua')
  );
  assert.ok(hasCrossLink, 'Should have a link between UA and US events sharing Putin');
});

test('buildCorrelationData ignores broad global organizations without topical evidence', () => {
  const now = Date.now();
  const events = [
    makeEvent({
      id: 'evt-health',
      title: 'WHO publishes malaria update for Ghana',
      primaryCountry: 'GH',
      firstSeenAt: new Date(now - 3600000).toISOString(),
      entities: { people: [], organizations: [{ name: 'WHO' }], locations: [] }
    }),
    makeEvent({
      id: 'evt-market',
      title: 'WHO mentioned in unrelated market roundup from Chile',
      primaryCountry: 'CL',
      firstSeenAt: new Date(now - 7200000).toISOString(),
      entities: { people: [], organizations: [{ name: 'WHO' }], locations: [] }
    }),
  ];
  const { correlations } = buildCorrelationData(events);
  assert.equal(correlations.length, 0, 'Broad global entities should not create weak correlation lines');
});

test('buildCorrelationData does not connect regions through location-only mentions', () => {
  const now = Date.now();
  const events = [
    makeEvent({
      id: 'evt-a',
      title: 'Markets react to sanctions in Ukraine',
      primaryCountry: 'US',
      firstSeenAt: new Date(now - 3600000).toISOString(),
      entities: { people: [], organizations: [], locations: [{ name: 'Ukraine' }] }
    }),
    makeEvent({
      id: 'evt-b',
      title: 'Aid convoy reaches Ukraine border',
      primaryCountry: 'PL',
      firstSeenAt: new Date(now - 7200000).toISOString(),
      entities: { people: [], organizations: [], locations: [{ name: 'Ukraine' }] }
    }),
  ];
  const { correlations } = buildCorrelationData(events);
  assert.equal(correlations.length, 0, 'Location-only overlap should not be enough for a professional correlation');
});

test('buildCorrelationData ignores entities that appear across too many regions', () => {
  const now = Date.now();
  const events = Array.from({ length: 10 }, (_, i) => makeEvent({
    id: `evt-broad-${i}`,
    title: `Regional security update ${i}`,
    primaryCountry: `R${i}`,
    firstSeenAt: new Date(now - i * 3600000).toISOString(),
    entities: { people: [{ name: 'Overexposed Actor' }], organizations: [], locations: [] }
  }));
  const { correlations } = buildCorrelationData(events, { maxEntityRegions: 8 });
  assert.equal(correlations.length, 0, 'Over-broad entities should not create a dense unreadable chart');
});

test('buildCorrelationInsights ranks region pairs and shared entity clusters', () => {
  const now = Date.now();
  const events = [
    makeEvent({
      id: 'evt-ua',
      title: 'Zelensky and NATO discuss air defense',
      primaryCountry: 'UA',
      severity: 80,
      firstSeenAt: new Date(now - 3600000).toISOString(),
      entities: { people: [{ name: 'Zelensky' }], organizations: [], locations: [] }
    }),
    makeEvent({
      id: 'evt-pl',
      title: 'Zelensky air defense talks continue in Poland',
      primaryCountry: 'PL',
      severity: 70,
      firstSeenAt: new Date(now - 7200000).toISOString(),
      entities: { people: [{ name: 'Zelensky' }], organizations: [], locations: [] }
    }),
  ];
  const { correlations } = buildCorrelationData(events);
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const insights = buildCorrelationInsights(correlations, eventMap);
  assert.equal(insights.topRegionPairs.length, 1);
  assert.equal(insights.topEntities[0].name, 'Zelensky');
  assert.deepEqual(insights.topEntities[0].regions, ['PL', 'UA']);
});

test('buildCorrelationData filters by entity query', () => {
  const now = Date.now();
  const events = [
    makeEvent({
      id: 'evt-a',
      primaryCountry: 'UA',
      firstSeenAt: new Date(now - 3600000).toISOString(),
      entities: { people: [{ name: 'Zelensky' }], organizations: [], locations: [] }
    }),
    makeEvent({
      id: 'evt-b',
      primaryCountry: 'SY',
      firstSeenAt: new Date(now - 7200000).toISOString(),
      entities: { people: [{ name: 'Assad' }], organizations: [], locations: [] }
    }),
  ];
  const { lanes } = buildCorrelationData(events, { entityFilter: 'zelensky' });
  assert.equal(lanes.length, 1, 'Only UA lane should remain');
  assert.equal(lanes[0].region, 'UA');
  assert.equal(lanes[0].events.length, 1);
});

test('buildCorrelationData filters by severity threshold', () => {
  const now = Date.now();
  const events = [
    makeEvent({ id: 'low', primaryCountry: 'UA', severity: 10, firstSeenAt: new Date(now).toISOString() }),
    makeEvent({ id: 'high', primaryCountry: 'UA', severity: 80, firstSeenAt: new Date(now).toISOString() }),
  ];
  const { lanes } = buildCorrelationData(events, { minSeverity: 70 });
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].events.length, 1);
  assert.equal(lanes[0].events[0].id, 'high');
});

test('buildCorrelationData filters by time range', () => {
  const now = Date.now();
  const recent = makeEvent({ id: 'recent', primaryCountry: 'UA', firstSeenAt: new Date(now - 3600000).toISOString() });
  const old = makeEvent({ id: 'old', primaryCountry: 'UA', firstSeenAt: new Date(now - 800 * 3600000).toISOString() });
  const { lanes } = buildCorrelationData([recent, old], { maxAgeHours: 720 });
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].events.length, 1);
  assert.equal(lanes[0].events[0].id, 'recent');
});

test('buildCorrelationData returns empty for no events', () => {
  const result = buildCorrelationData([]);
  assert.equal(result.lanes.length, 0);
  assert.equal(result.correlations.length, 0);
});

test('buildCorrelationData returns empty for null input', () => {
  const result = buildCorrelationData(null);
  assert.equal(result.lanes.length, 0);
});

test('severityColor returns correct colors', () => {
  assert.equal(severityColor(75), 'var(--sev-red)');
  assert.equal(severityColor(50), 'var(--sev-amber)');
  assert.equal(severityColor(30), 'var(--amber)');
  assert.equal(severityColor(10), 'var(--sev-green)');
});

// ── Component file existence tests ──────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';

const COMPONENT_PATH = path.resolve('src/components/EventCorrelationTimeline.jsx');
const UTIL_PATH = path.resolve('src/utils/correlationBuilder.js');

test('EventCorrelationTimeline component file exists', () => {
  assert.ok(fs.existsSync(COMPONENT_PATH), 'EventCorrelationTimeline.jsx should exist');
});

test('correlationBuilder utility file exists', () => {
  assert.ok(fs.existsSync(UTIL_PATH), 'correlationBuilder.js should exist');
});

test('EventCorrelationTimeline exports a default component', () => {
  const src = fs.readFileSync(COMPONENT_PATH, 'utf8');
  assert.ok(src.includes('export default function EventCorrelationTimeline'), 'Should export EventCorrelationTimeline as default');
});

test('EventCorrelationTimeline renders lane chart SVG', () => {
  const src = fs.readFileSync(COMPONENT_PATH, 'utf8');
  assert.ok(src.includes('<svg'), 'Should contain SVG element for lane chart');
  assert.ok(src.includes('data-testid="correlation-timeline"'), 'Should have correlation-timeline testid');
  assert.ok(src.includes('data-testid="correlation-insights"'), 'Should show ranked correlation insight cards');
  assert.ok(src.includes('data-testid="correlation-entity-clusters"'), 'Should show shared entity clusters');
  assert.ok(src.includes('Evidence timeline'), 'Should frame the SVG as secondary evidence, not the whole experience');
  assert.ok(src.includes('MAX_VISIBLE_LANES'), 'Should cap timeline lanes so the tab is not a very long chart');
  assert.ok(src.includes('data-testid="correlation-chart"'), 'Should have correlation-chart testid');
  assert.ok(src.includes('data-testid="correlation-entity-filter"'), 'Should have entity filter input');
  assert.ok(src.includes('data-testid="correlation-empty"'), 'Should have empty state');
  assert.ok(src.includes('data-testid="correlation-detail"'), 'Should have detail panel');
});

test('TrendAnalysisPage has correlation tab', () => {
  const trendsSrc = fs.readFileSync(path.resolve('src/pages/TrendAnalysisPage.jsx'), 'utf8');
  assert.ok(trendsSrc.includes('correlation'), 'TrendAnalysisPage should reference correlation');
  assert.ok(trendsSrc.includes('EventCorrelationTimeline'), 'Should import EventCorrelationTimeline');
  assert.ok(trendsSrc.includes('tabAriaLabel'), 'Should have tab aria label');
});

test('EntityExplorerPage has timeline navigation', () => {
  const entitySrc = fs.readFileSync(path.resolve('src/pages/EntityExplorerPage.jsx'), 'utf8');
  assert.ok(entitySrc.includes('showTimeline'), 'Should define showTimeline');
  assert.ok(entitySrc.includes('correlation'), 'Should have correlation reference');
  assert.ok(entitySrc.includes('/trends?tab=correlation'), 'Should navigate to trends correlation tab');
});

test('All 5 locale files have correlation keys', () => {
  const locales = ['en', 'es', 'fr', 'ar', 'zh'];
  for (const loc of locales) {
    const content = fs.readFileSync(path.resolve(`src/i18n/locales/${loc}.json`), 'utf8');
    const json = JSON.parse(content);
    assert.ok(json.correlation, `${loc}: correlation section should exist`);
    assert.ok(json.correlation.title, `${loc}: correlation.title should exist`);
    assert.ok(json.correlation.entityFilter, `${loc}: correlation.entityFilter should exist`);
    assert.ok(json.correlation.timeRangeFilter, `${loc}: correlation.timeRangeFilter should exist`);
    assert.ok(json.correlation.severityFilter, `${loc}: correlation.severityFilter should exist`);
    assert.ok(json.trends.tabCharts, `${loc}: trends.tabCharts should exist`);
    assert.ok(json.trends.tabCorrelation, `${loc}: trends.tabCorrelation should exist`);
  }
});
