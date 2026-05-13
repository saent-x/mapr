import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeArticles } from '../src/utils/newsPipeline.js';
import {
  getEventDetailCandidates,
  resolveEventById,
} from '../src/utils/eventDetailResolver.js';

function article(overrides = {}) {
  return {
    id: overrides.id || 'raw-1',
    title: overrides.title || 'Port workers strike after security incident',
    summary: overrides.summary || 'Port disruption reported by multiple sources.',
    url: overrides.url || `https://example.com/${overrides.id || 'raw-1'}`,
    source: overrides.source || 'Example Wire',
    publishedAt: overrides.publishedAt || '2026-05-10T12:00:00.000Z',
    isoA2: overrides.isoA2 || 'US',
    region: overrides.region || 'United States',
    locality: overrides.locality || 'New York',
    category: overrides.category || 'Security',
    severity: overrides.severity ?? 72,
    coordinates: overrides.coordinates || [40.7128, -74.006],
    entities: overrides.entities || {
      people: [],
      organizations: [{ name: 'Port Authority' }],
      locations: [{ name: 'New York' }],
    },
  };
}

test('every clickable canonical event id resolves on the event detail route candidates', () => {
  const liveNews = [
    article({ id: 'raw-a', source: 'Wire A', url: 'https://a.example/story' }),
    article({ id: 'raw-b', source: 'Wire B', url: 'https://b.example/story', publishedAt: '2026-05-10T12:05:00.000Z' }),
  ];
  const clickableEvents = canonicalizeArticles(liveNews);

  assert.ok(clickableEvents.length > 0, 'fixture must produce clickable canonical events');
  assert.notEqual(clickableEvents[0].id, liveNews[0].id, 'fixture must expose the raw/canonical ID split');

  const candidates = getEventDetailCandidates({
    liveNews,
    backendEvents: [
      {
        id: 'evt-server-different-id',
        title: clickableEvents[0].title,
        primaryCountry: 'US',
        countries: ['US'],
        severity: 72,
      },
    ],
  });

  for (const event of clickableEvents) {
    const resolved = resolveEventById(candidates, event.id);
    assert.ok(resolved, `clickable /event/${event.id} should resolve`);
    assert.equal(resolved.id, event.id);
  }
});

test('historical time-travel canonical event ids are event detail candidates', () => {
  const historicalState = {
    snapshots: [
      {
        at: '2026-05-10T10:00:00.000Z',
        eventSummary: [
          {
            id: 'evt-server-historical',
            title: 'Historical cabinet vote escalates',
            severity: 66,
            primaryCountry: 'GB',
            category: 'Political',
            lifecycle: 'developing',
          },
        ],
      },
    ],
  };

  const candidates = getEventDetailCandidates({ historicalState });
  const clickable = candidates.find((event) => event.title === 'Historical cabinet vote escalates');

  assert.ok(clickable, 'historical event should be present in detail candidates');
  assert.ok(resolveEventById(candidates, clickable.id), `historical /event/${clickable.id} should resolve`);
});
