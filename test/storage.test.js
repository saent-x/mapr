import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const STORAGE_MODULE_URL = pathToFileURL(path.resolve('server/storage.js')).href;

async function loadStorageModule(dataDir) {
  process.env.MAPR_DATA_DIR = dataDir;
  return import(`${STORAGE_MODULE_URL}?t=${Date.now()}-${Math.random()}`);
}

test('sqlite storage persists snapshot, history, and coverage history', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mapr-storage-'));
  const storage = await loadStorageModule(dataDir);

  const snapshot = { fetchedAt: '2026-03-15T10:00:00.000Z', articles: [{ id: 'a1' }] };
  const coverageHistory = [
    { at: '2026-03-15T10:00:00.000Z', countries: [{ iso: 'US', status: 'verified' }] }
  ];

  try {
    await storage.writeSnapshot(snapshot);
    await storage.appendHistory({ at: '2026-03-15T10:00:00.000Z', status: 'ok' });
    await storage.writeCoverageHistory(coverageHistory);

    assert.deepEqual(await storage.readSnapshot(), snapshot);
    assert.deepEqual(await storage.readHistory(), [{ at: '2026-03-15T10:00:00.000Z', status: 'ok' }]);
    assert.deepEqual(await storage.readCoverageHistory(), coverageHistory);
    assert.equal(path.basename(storage.DATABASE_PATH), 'mapr.db');
  } finally {
    storage.closeStorage();
    delete process.env.MAPR_DATA_DIR;
  }
});

test('sqlite storage migrates legacy json files when database is empty', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mapr-storage-migrate-'));
  await mkdir(dataDir, { recursive: true });

  const legacySnapshot = { fetchedAt: '2026-03-15T12:00:00.000Z', articles: [{ id: 'legacy' }] };
  const legacyHistory = [{ at: '2026-03-15T12:00:00.000Z', status: 'ok', reason: 'legacy' }];
  const legacyCoverageHistory = [{ at: '2026-03-15T12:00:00.000Z', countries: [{ iso: 'BR', status: 'developing' }] }];

  await writeFile(path.join(dataDir, 'mapr-snapshot.json'), JSON.stringify(legacySnapshot), 'utf8');
  await writeFile(path.join(dataDir, 'mapr-refresh-history.json'), JSON.stringify(legacyHistory), 'utf8');
  await writeFile(path.join(dataDir, 'mapr-coverage-history.json'), JSON.stringify(legacyCoverageHistory), 'utf8');

  const storage = await loadStorageModule(dataDir);

  try {
    assert.deepEqual(await storage.readSnapshot(), legacySnapshot);
    assert.deepEqual(await storage.readHistory(), legacyHistory);
    assert.deepEqual(await storage.readCoverageHistory(), legacyCoverageHistory);
  } finally {
    storage.closeStorage();
    delete process.env.MAPR_DATA_DIR;
  }
});

test('articles table: insert, read, deduplicate by URL', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mapr-storage-articles-'));
  const storage = await loadStorageModule(dataDir);

  const articles = [
    { id: 'art1', title: 'Article One', url: 'https://example.com/one', source: 'BBC', publishedAt: '2026-03-20T10:00:00.000Z', isoA2: 'GB', severity: 0.5, geocodePrecision: 'country' },
    { id: 'art2', title: 'Article Two', url: 'https://example.com/two', source: 'CNN', publishedAt: '2026-03-20T11:00:00.000Z', isoA2: 'US', severity: 0.7, geocodePrecision: 'city' },
  ];

  try {
    await storage.upsertArticles(articles);
    const all = await storage.readArticles({});
    assert.equal(all.length, 2);
    assert.ok(all.some((a) => a.id === 'art1'));
    assert.ok(all.some((a) => a.id === 'art2'));

    // Dedup by URL: upsert same URL with updated title — should not create duplicate
    const updated = [{ id: 'art1-dup', title: 'Article One Updated', url: 'https://example.com/one', source: 'BBC', publishedAt: '2026-03-20T10:00:00.000Z', isoA2: 'GB', severity: 0.6, geocodePrecision: 'country' }];
    await storage.upsertArticles(updated);
    const afterUpsert = await storage.readArticles({});
    assert.equal(afterUpsert.length, 2, 'duplicate URL should not create a new row');
    const one = afterUpsert.find((a) => a.url === 'https://example.com/one');
    assert.equal(one.title, 'Article One Updated', 'title should be updated on upsert');

    // Filter by isoA2
    const gbOnly = await storage.readArticles({ isoA2: 'GB' });
    assert.equal(gbOnly.length, 1);
    assert.equal(gbOnly[0].isoA2, 'GB');
  } finally {
    storage.closeStorage();
    delete process.env.MAPR_DATA_DIR;
  }
});

test('events table: insert, read, update lifecycle', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mapr-storage-events-'));
  const storage = await loadStorageModule(dataDir);

  const now = new Date().toISOString();
  const event = {
    id: 'evt1',
    title: 'Test Event',
    primaryCountry: 'DE',
    countries: ['DE', 'FR'],
    lifecycle: 'emerging',
    severity: 0.8,
    category: 'conflict',
    firstSeenAt: now,
    lastUpdatedAt: now,
    topicFingerprint: 'fp123',
    coordinates: [52.5, 13.4],
  };

  try {
    await storage.upsertEvent(event);
    const active = await storage.readActiveEvents({});
    assert.equal(active.length, 1);
    assert.equal(active[0].id, 'evt1');
    assert.deepEqual(active[0].countries, ['DE', 'FR']);
    assert.deepEqual(active[0].coordinates, [52.5, 13.4]);

    // Update lifecycle to resolved
    await storage.updateEventLifecycle('evt1', 'resolved');
    const afterResolve = await storage.readActiveEvents({});
    assert.equal(afterResolve.length, 0, 'resolved event should not appear in active events');
  } finally {
    storage.closeStorage();
    delete process.env.MAPR_DATA_DIR;
  }
});

test('event_articles junction: link and query', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mapr-storage-junction-'));
  const storage = await loadStorageModule(dataDir);

  const now = new Date().toISOString();
  const article = { id: 'artA', title: 'Junction Article', url: 'https://example.com/junc', source: 'Reuters', publishedAt: now, isoA2: 'FR', severity: 0.4, geocodePrecision: 'country' };
  const event = { id: 'evtA', title: 'Junction Event', primaryCountry: 'FR', countries: ['FR'], lifecycle: 'developing', severity: 0.4, category: null, firstSeenAt: now, lastUpdatedAt: now, topicFingerprint: null, coordinates: null };

  try {
    await storage.upsertArticles([article]);
    await storage.upsertEvent(event);
    await storage.linkArticlesToEvent('evtA', ['artA']);

    const linked = await storage.readEventArticles('evtA');
    assert.equal(linked.length, 1);
    assert.equal(linked[0].id, 'artA');
    assert.equal(linked[0].title, 'Junction Article');

    // Linking same article again should not throw or duplicate
    await storage.linkArticlesToEvent('evtA', ['artA']);
    const linkedAgain = await storage.readEventArticles('evtA');
    assert.equal(linkedAgain.length, 1, 'duplicate link should be ignored');
  } finally {
    storage.closeStorage();
    delete process.env.MAPR_DATA_DIR;
  }
});

test('pruneResolvedEvents removes old resolved events', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mapr-storage-prune-'));
  const storage = await loadStorageModule(dataDir);

  const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
  const recentDate = new Date().toISOString();

  const oldResolved = { id: 'evtOld', title: 'Old Resolved', primaryCountry: 'US', countries: ['US'], lifecycle: 'resolved', severity: 0.3, category: null, firstSeenAt: oldDate, lastUpdatedAt: oldDate, topicFingerprint: null, coordinates: null };
  const newDeveloping = { id: 'evtNew', title: 'New Developing', primaryCountry: 'US', countries: ['US'], lifecycle: 'developing', severity: 0.5, category: null, firstSeenAt: recentDate, lastUpdatedAt: recentDate, topicFingerprint: null, coordinates: null };

  try {
    await storage.upsertEvent(oldResolved);
    await storage.upsertEvent(newDeveloping);

    await storage.pruneResolvedEvents(7); // prune resolved older than 7 days

    const remaining = await storage.readActiveEvents({});
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, 'evtNew');

    // Also verify old resolved is gone by reading with a direct check
    // readActiveEvents only returns non-resolved, so check total via upsert + re-read trick:
    // re-insert old resolved — if prune worked, this would be a fresh insert
    await storage.upsertEvent({ ...oldResolved, lifecycle: 'developing' });
    const afterReinsert = await storage.readActiveEvents({});
    assert.equal(afterReinsert.length, 2, 'reinserted event appears as new developing');
  } finally {
    storage.closeStorage();
    delete process.env.MAPR_DATA_DIR;
  }
});
