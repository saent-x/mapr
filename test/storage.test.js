import test from 'node:test';
import assert from 'node:assert/strict';

// Storage tests require DATABASE_URL (Postgres).
// Skip gracefully when not available (e.g., CI without database).
const HAS_DB = !!process.env.DATABASE_URL;

function skipWithoutDb(name, fn) {
  if (!HAS_DB) {
    test(name, { skip: 'DATABASE_URL not set' }, () => {});
  } else {
    test(name, fn);
  }
}

skipWithoutDb('postgres storage persists snapshot, history, and coverage history', async () => {
  const storage = await import('../server/storage.js');

  const snapshot = { fetchedAt: '2026-03-15T10:00:00.000Z', articles: [{ id: 'a1' }] };

  await storage.writeSnapshot(snapshot);
  const read = await storage.readSnapshot();
  assert.deepEqual(read, snapshot);

  await storage.appendHistory({ at: '2026-03-15T10:00:00.000Z', status: 'ok' });
  const history = await storage.readHistory();
  assert.ok(history.length >= 1);
  assert.equal(history[0].status, 'ok');

  await storage.closeStorage();
});

skipWithoutDb('articles table: insert, read, deduplicate by URL', async () => {
  const storage = await import('../server/storage.js');

  const article = {
    id: 'test-1',
    title: 'Test article',
    url: `https://example.com/article-${Date.now()}`,
    source: 'example',
    publishedAt: new Date().toISOString(),
    isoA2: 'US',
    severity: 50,
    geocodePrecision: 'country'
  };

  await storage.upsertArticles([article]);
  const articles = await storage.readArticles({ since: new Date(Date.now() - 86400000).toISOString() });
  assert.ok(articles.some(a => a.title === 'Test article'));

  // Upsert same URL — should update, not duplicate
  await storage.upsertArticles([{ ...article, title: 'Updated title' }]);
  const articles2 = await storage.readArticles({ since: new Date(Date.now() - 86400000).toISOString() });
  const matching = articles2.filter(a => a.url === article.url);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].title, 'Updated title');

  await storage.closeStorage();
});

skipWithoutDb('events table: insert, read, update lifecycle', async () => {
  const storage = await import('../server/storage.js');

  const eventId = `evt-test-${Date.now()}`;
  const event = {
    id: eventId,
    title: 'Test Event',
    primaryCountry: 'TR',
    countries: ['TR', 'SY'],
    lifecycle: 'emerging',
    severity: 75,
    category: 'disaster',
    firstSeenAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    topicFingerprint: JSON.stringify(['earthquake', 'turkey']),
    coordinates: null,
    enrichment: '{}'
  };

  await storage.upsertEvent(event);
  const events = await storage.readActiveEvents();
  const found = events.find(e => e.id === eventId);
  assert.ok(found);
  assert.equal(found.lifecycle, 'emerging');

  await storage.updateEventLifecycle(eventId, 'developing');
  const events2 = await storage.readActiveEvents();
  const found2 = events2.find(e => e.id === eventId);
  assert.equal(found2.lifecycle, 'developing');

  await storage.closeStorage();
});

skipWithoutDb('event_articles junction: link and query', async () => {
  const storage = await import('../server/storage.js');

  const ts = Date.now();
  const articles = [
    { id: `a1-${ts}`, title: 'Article 1', url: `https://example.com/1-${ts}`, source: 'ex', publishedAt: new Date().toISOString(), isoA2: 'TR', severity: 50, geocodePrecision: 'country' },
    { id: `a2-${ts}`, title: 'Article 2', url: `https://example.com/2-${ts}`, source: 'ex', publishedAt: new Date().toISOString(), isoA2: 'TR', severity: 60, geocodePrecision: 'country' }
  ];
  await storage.upsertArticles(articles);

  const eventId = `evt-link-${ts}`;
  await storage.upsertEvent({
    id: eventId, title: 'Event', primaryCountry: 'TR', countries: ['TR'],
    lifecycle: 'emerging', severity: 55, category: 'disaster',
    firstSeenAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(),
    topicFingerprint: null, coordinates: null, enrichment: '{}'
  });

  await storage.linkArticlesToEvent(eventId, articles.map(a => a.id));
  const linked = await storage.readEventArticles(eventId);
  assert.equal(linked.length, 2);

  await storage.closeStorage();
});
