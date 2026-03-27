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
