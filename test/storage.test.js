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
