# Phase 1: Event Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make events persistent with stable IDs and lifecycle states, so the same real-world situation survives across refresh cycles and the analyst can track evolving situations.

**Architecture:** Extend the existing `canonicalizeArticles()` pipeline (already clusters articles into events) with: (1) stable event IDs based on content rather than article fingerprints, (2) lifecycle state machine (emerging → developing → escalating → stabilizing → resolved), (3) SQLite persistence for events and articles with proper relational tables, (4) server-side event merging across refresh cycles. The client receives events from the API and renders them instead of raw articles.

**Tech Stack:** SQLite (already used via `server/storage.js`), Node built-in `crypto` for stable hashing, IndexedDB (Phase 3 — not in this plan).

**Spec:** `docs/superpowers/specs/2026-03-22-mapr-pro-osint-upgrade-design.md` — Phase 1 section.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/utils/eventModel.js` | Stable event ID generation, lifecycle state machine, lifecycle transition logic. Shared between server and client. |
| `server/eventStore.js` | Event CRUD operations against SQLite. Merge new articles into existing events. Persist and query events. |
| `test/eventModel.test.js` | Tests for ID generation, lifecycle transitions. |
| `test/eventStore.test.js` | Tests for event persistence, merging, pruning. |

### Modified Files

| File | Change |
|------|--------|
| `src/utils/newsPipeline.js` | Export `tokenizeHeadline` and `jaccardSimilarity` (currently private). |
| `server/storage.js` | Add `articles`, `events`, `event_articles` tables. Add CRUD functions. |
| `server/ingest.js` | After fetching articles, merge them into persistent events via `eventStore`. Include lifecycle-enriched events in the briefing response. |
| `api/_lib/fetchBriefing.js` | Use event store when available, fall back to in-memory canonicalization for serverless (Vercel). |
| `src/App.jsx` | Consume `events` from briefing, pass events (not raw articles) to child components. Extract data-fetching into `useEventData` hook. |
| `src/components/NewsPanel.jsx` | Render event cards with lifecycle badge. Expand to show supporting articles as evidence. |
| `src/components/Globe.jsx` | Render events as map dots. Size = articleCount. Add lifecycle color to tooltip. |
| `src/components/FlatMap.jsx` | Same changes as Globe. |
| `src/components/ArcPanel.jsx` | Derive arcs from events sharing countries (instead of article headline overlap). |

---

## Tasks

### Task 1: Export shared utilities from newsPipeline.js

**Files:**
- Modify: `src/utils/newsPipeline.js` (lines 29-52, add `export` keywords)
- Test: `test/newsPipeline.test.js` (add import verification)

- [ ] **Step 1: Write test verifying exports**

Add to the top of `test/newsPipeline.test.js`:

```javascript
import { tokenizeHeadline, jaccardSimilarity } from '../src/utils/newsPipeline.js';

test('tokenizeHeadline is exported and works', () => {
  const tokens = tokenizeHeadline('Wagner Group fighters deployed to Mali');
  assert.ok(Array.isArray(tokens));
  assert.ok(tokens.includes('wagner'));
  assert.ok(tokens.includes('mali'));
  assert.ok(!tokens.includes('the'));
});

test('jaccardSimilarity is exported and works', () => {
  const a = ['wagner', 'group', 'mali'];
  const b = ['wagner', 'group', 'libya'];
  const score = jaccardSimilarity(a, b);
  assert.ok(score > 0.4);
  assert.ok(score < 0.8);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/newsPipeline.test.js`
Expected: FAIL — `tokenizeHeadline` and `jaccardSimilarity` are not exported.

- [ ] **Step 3: Add exports to newsPipeline.js**

In `src/utils/newsPipeline.js`, add `export` to the two function declarations:

Change `function tokenizeHeadline(title)` (line 29) to `export function tokenizeHeadline(title)`.

Change `function jaccardSimilarity(leftTokens, rightTokens)` (line 35) to `export function jaccardSimilarity(leftTokens, rightTokens)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/newsPipeline.test.js`
Expected: PASS — all tests including the new export tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/newsPipeline.js test/newsPipeline.test.js
git commit -m "refactor: export tokenizeHeadline and jaccardSimilarity from newsPipeline"
```

---

### Task 2: Create eventModel.js — stable ID generation and lifecycle logic

**Files:**
- Create: `src/utils/eventModel.js`
- Create: `test/eventModel.test.js`

- [ ] **Step 1: Write failing tests for stable event ID generation**

Create `test/eventModel.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateEventId,
  computeTopicFingerprint,
  LIFECYCLE_STATES,
  computeLifecycleTransition
} from '../src/utils/eventModel.js';

test('computeTopicFingerprint returns sorted top tokens', () => {
  const articles = [
    { title: 'Turkey earthquake kills hundreds in southern region' },
    { title: 'Earthquake in Turkey leaves hundreds dead' },
    { title: 'Southern Turkey hit by devastating earthquake' }
  ];
  const fp = computeTopicFingerprint(articles);
  assert.ok(Array.isArray(fp));
  assert.ok(fp.length <= 5);
  assert.ok(fp.includes('earthquake'));
  assert.ok(fp.includes('turkey'));
  // Tokens should be sorted alphabetically
  const sorted = [...fp].sort();
  assert.deepEqual(fp, sorted);
});

test('generateEventId is stable for same inputs', () => {
  const id1 = generateEventId('TR', ['earthquake', 'turkey', 'hundreds']);
  const id2 = generateEventId('TR', ['earthquake', 'turkey', 'hundreds']);
  assert.equal(id1, id2);
  assert.ok(id1.startsWith('evt-'));
  assert.equal(id1.length, 20); // 'evt-' + 16 hex chars
});

test('generateEventId differs for different countries', () => {
  const id1 = generateEventId('TR', ['earthquake', 'turkey']);
  const id2 = generateEventId('SY', ['earthquake', 'turkey']);
  assert.notEqual(id1, id2);
});

test('generateEventId differs for different topics', () => {
  const id1 = generateEventId('TR', ['earthquake', 'turkey']);
  const id2 = generateEventId('TR', ['protest', 'istanbul']);
  assert.notEqual(id1, id2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/eventModel.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement ID generation**

Create `src/utils/eventModel.js`:

```javascript
import { createHash } from 'node:crypto';
import { tokenizeHeadline } from './newsPipeline.js';

/**
 * Lifecycle states in priority order (highest priority first for transition logic).
 */
export const LIFECYCLE_STATES = ['resolved', 'escalating', 'stabilizing', 'developing', 'emerging'];

/**
 * Compute the topic fingerprint for a set of articles.
 * Returns the top 5 most frequent tokens sorted alphabetically.
 */
export function computeTopicFingerprint(articles) {
  const freq = {};
  for (const article of articles) {
    const tokens = tokenizeHeadline(article.title);
    for (const token of tokens) {
      freq[token] = (freq[token] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([token]) => token)
    .sort();
}

/**
 * Generate a stable event ID from primary country and topic fingerprint.
 * Format: evt-<16 hex chars of sha256>
 */
export function generateEventId(primaryCountry, topicTokens) {
  const input = primaryCountry + ':' + topicTokens.join(',');
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 16);
  return `evt-${hash}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/eventModel.test.js`
Expected: PASS for all 4 ID generation tests.

- [ ] **Step 5: Write failing tests for lifecycle transitions**

Add to `test/eventModel.test.js`:

```javascript
test('new event starts as emerging', () => {
  const now = Date.now();
  const state = computeLifecycleTransition({
    lifecycle: null,
    firstSeenAt: new Date(now - 30 * 60 * 1000).toISOString(), // 30 min ago
    articleCount: 2,
    lastUpdatedAt: new Date(now - 10 * 60 * 1000).toISOString(),
    prevWindowArticleCount: 0,
    currWindowArticleCount: 2
  });
  assert.equal(state, 'emerging');
});

test('event with 4 sources transitions to developing', () => {
  const now = Date.now();
  const state = computeLifecycleTransition({
    lifecycle: 'emerging',
    firstSeenAt: new Date(now - 60 * 60 * 1000).toISOString(), // 1h ago
    articleCount: 4,
    lastUpdatedAt: new Date(now - 5 * 60 * 1000).toISOString(),
    prevWindowArticleCount: 1,
    currWindowArticleCount: 3
  });
  assert.equal(state, 'developing');
});

test('event with 50%+ velocity increase transitions to escalating', () => {
  const now = Date.now();
  const state = computeLifecycleTransition({
    lifecycle: 'developing',
    firstSeenAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(), // 6h ago
    articleCount: 12,
    lastUpdatedAt: new Date(now - 5 * 60 * 1000).toISOString(),
    prevWindowArticleCount: 3,
    currWindowArticleCount: 7 // 133% increase
  });
  assert.equal(state, 'escalating');
});

test('event with no articles in 6h transitions to stabilizing', () => {
  const now = Date.now();
  const state = computeLifecycleTransition({
    lifecycle: 'escalating',
    firstSeenAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    articleCount: 20,
    lastUpdatedAt: new Date(now - 7 * 60 * 60 * 1000).toISOString(), // 7h ago
    prevWindowArticleCount: 5,
    currWindowArticleCount: 0
  });
  assert.equal(state, 'stabilizing');
});

test('event with no articles in 24h transitions to resolved', () => {
  const now = Date.now();
  const state = computeLifecycleTransition({
    lifecycle: 'developing',
    firstSeenAt: new Date(now - 72 * 60 * 60 * 1000).toISOString(),
    articleCount: 8,
    lastUpdatedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
    prevWindowArticleCount: 0,
    currWindowArticleCount: 0
  });
  assert.equal(state, 'resolved');
});

test('resolved takes priority over other rules', () => {
  const now = Date.now();
  const state = computeLifecycleTransition({
    lifecycle: 'escalating',
    firstSeenAt: new Date(now - 72 * 60 * 60 * 1000).toISOString(),
    articleCount: 50,
    lastUpdatedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
    prevWindowArticleCount: 10,
    currWindowArticleCount: 8 // velocity decrease, but also >24h
  });
  assert.equal(state, 'resolved');
});
```

- [ ] **Step 6: Run test to verify lifecycle tests fail**

Run: `node --test test/eventModel.test.js`
Expected: FAIL — `computeLifecycleTransition` is not defined.

- [ ] **Step 7: Implement lifecycle transitions**

Add to `src/utils/eventModel.js`:

```javascript
const HOUR_MS = 60 * 60 * 1000;

/**
 * Compute the lifecycle state for an event.
 * Rules evaluated in priority order — first match wins.
 *
 * @param {Object} ctx
 * @param {string|null} ctx.lifecycle - current lifecycle state
 * @param {string} ctx.firstSeenAt - ISO timestamp
 * @param {number} ctx.articleCount - total articles in event
 * @param {string} ctx.lastUpdatedAt - ISO timestamp of most recent article
 * @param {number} ctx.prevWindowArticleCount - articles in previous 2h window
 * @param {number} ctx.currWindowArticleCount - articles in current 2h window
 * @returns {string} lifecycle state
 */
export function computeLifecycleTransition(ctx) {
  const now = Date.now();
  const lastUpdatedMs = new Date(ctx.lastUpdatedAt).getTime();
  const firstSeenMs = new Date(ctx.firstSeenAt).getTime();
  const hoursSinceUpdate = (now - lastUpdatedMs) / HOUR_MS;
  const ageHours = (now - firstSeenMs) / HOUR_MS;

  // Priority 1: resolved — no new articles in 24h
  if (hoursSinceUpdate >= 24) {
    return 'resolved';
  }

  // Priority 2: escalating — article velocity increased 50%+ in current vs previous window
  if (ctx.prevWindowArticleCount > 0 &&
      ctx.currWindowArticleCount >= ctx.prevWindowArticleCount * 1.5) {
    return 'escalating';
  }

  // Priority 3: stabilizing — was escalating/developing, no new articles in 6h
  if ((ctx.lifecycle === 'escalating' || ctx.lifecycle === 'developing') &&
      hoursSinceUpdate >= 6) {
    return 'stabilizing';
  }

  // Priority 4: developing — 3+ sources OR age > 2h
  if (ctx.articleCount >= 3 || ageHours > 2) {
    return 'developing';
  }

  // Priority 5: emerging — default for new events
  return 'emerging';
}
```

- [ ] **Step 8: Run all tests to verify they pass**

Run: `node --test test/eventModel.test.js`
Expected: PASS — all 10 tests.

- [ ] **Step 9: Commit**

```bash
git add src/utils/eventModel.js test/eventModel.test.js
git commit -m "feat: add eventModel with stable ID generation and lifecycle state machine"
```

---

### Task 3: Add relational tables to storage.js

**Files:**
- Modify: `server/storage.js` (lines 33-53, add new tables + CRUD functions)
- Modify: `test/storage.test.js` (add tests for new tables)

- [ ] **Step 1: Write failing tests for new tables**

Add to `test/storage.test.js`:

```javascript
test('articles table: insert, read, deduplicate by URL', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mapr-storage-'));
  const storage = await loadStorageModule(dataDir);

  const article = {
    id: 'test-1',
    title: 'Test article',
    url: 'https://example.com/article-1',
    source: 'example',
    publishedAt: new Date().toISOString(),
    isoA2: 'US',
    severity: 50,
    geocodePrecision: 'country'
  };

  await storage.upsertArticles([article]);
  const articles = await storage.readArticles({ since: new Date(Date.now() - 86400000).toISOString() });
  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, 'Test article');

  // Upsert same URL — should not duplicate
  await storage.upsertArticles([{ ...article, title: 'Updated title' }]);
  const articles2 = await storage.readArticles({ since: new Date(Date.now() - 86400000).toISOString() });
  assert.equal(articles2.length, 1);
  assert.equal(articles2[0].title, 'Updated title');

  storage.closeStorage();
});

test('events table: insert, read, update lifecycle', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mapr-storage-'));
  const storage = await loadStorageModule(dataDir);

  const event = {
    id: 'evt-abc123',
    title: 'Test Event',
    primaryCountry: 'TR',
    countries: JSON.stringify(['TR', 'SY']),
    lifecycle: 'emerging',
    severity: 75,
    category: 'disaster',
    firstSeenAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    topicFingerprint: JSON.stringify(['earthquake', 'turkey']),
    coordinates: JSON.stringify([39.0, 35.0])
  };

  await storage.upsertEvent(event);
  const events = await storage.readActiveEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].lifecycle, 'emerging');

  // Update lifecycle
  await storage.updateEventLifecycle('evt-abc123', 'developing');
  const events2 = await storage.readActiveEvents();
  assert.equal(events2[0].lifecycle, 'developing');

  storage.closeStorage();
});

test('event_articles junction: link and query', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mapr-storage-'));
  const storage = await loadStorageModule(dataDir);

  await storage.upsertArticles([
    { id: 'a1', title: 'Article 1', url: 'https://example.com/1', source: 'ex', publishedAt: new Date().toISOString(), isoA2: 'TR', severity: 50, geocodePrecision: 'country' },
    { id: 'a2', title: 'Article 2', url: 'https://example.com/2', source: 'ex', publishedAt: new Date().toISOString(), isoA2: 'TR', severity: 60, geocodePrecision: 'country' }
  ]);

  await storage.upsertEvent({
    id: 'evt-123', title: 'Event', primaryCountry: 'TR', countries: JSON.stringify(['TR']),
    lifecycle: 'emerging', severity: 55, category: 'disaster',
    firstSeenAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(),
    topicFingerprint: JSON.stringify(['earthquake']), coordinates: JSON.stringify([39.0, 35.0])
  });

  await storage.linkArticlesToEvent('evt-123', ['a1', 'a2']);
  const linked = await storage.readEventArticles('evt-123');
  assert.equal(linked.length, 2);

  storage.closeStorage();
});

test('pruneResolvedEvents removes old resolved events', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mapr-storage-'));
  const storage = await loadStorageModule(dataDir);

  const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(); // 31 days ago

  await storage.upsertEvent({
    id: 'evt-old', title: 'Old Event', primaryCountry: 'US', countries: JSON.stringify(['US']),
    lifecycle: 'resolved', severity: 30, category: 'political',
    firstSeenAt: oldDate, lastUpdatedAt: oldDate,
    topicFingerprint: JSON.stringify(['old']), coordinates: JSON.stringify([40.0, -74.0])
  });

  await storage.upsertEvent({
    id: 'evt-new', title: 'New Event', primaryCountry: 'US', countries: JSON.stringify(['US']),
    lifecycle: 'developing', severity: 60, category: 'conflict',
    firstSeenAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(),
    topicFingerprint: JSON.stringify(['new']), coordinates: JSON.stringify([40.0, -74.0])
  });

  await storage.pruneResolvedEvents(30);
  const events = await storage.readActiveEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'evt-new');

  storage.closeStorage();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/storage.test.js`
Expected: FAIL — `upsertArticles`, `upsertEvent`, etc. are not defined.

- [ ] **Step 3: Add table schema to ensureDatabase()**

In `server/storage.js`, inside the `ensureDatabase()` function, add these tables after the existing `CREATE TABLE` statements (after line 52):

```javascript
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT UNIQUE,
      source TEXT,
      publishedAt TEXT,
      isoA2 TEXT,
      severity REAL,
      geocodePrecision TEXT,
      payload TEXT NOT NULL,
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      primaryCountry TEXT NOT NULL,
      countries TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'emerging',
      severity REAL NOT NULL DEFAULT 0,
      category TEXT,
      firstSeenAt TEXT NOT NULL,
      lastUpdatedAt TEXT NOT NULL,
      topicFingerprint TEXT,
      coordinates TEXT,
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS event_articles (
      eventId TEXT NOT NULL,
      articleId TEXT NOT NULL,
      PRIMARY KEY (eventId, articleId),
      FOREIGN KEY (eventId) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (articleId) REFERENCES articles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_events_lifecycle ON events(lifecycle);
    CREATE INDEX IF NOT EXISTS idx_events_lastUpdated ON events(lastUpdatedAt);
    CREATE INDEX IF NOT EXISTS idx_articles_isoA2 ON articles(isoA2);
    CREATE INDEX IF NOT EXISTS idx_articles_publishedAt ON articles(publishedAt);
```

- [ ] **Step 4: Implement CRUD functions**

Add to `server/storage.js` after the existing functions:

```javascript
export async function upsertArticles(articles) {
  const db = ensureDatabase();
  const stmt = prepareStatement(db,
    `INSERT INTO articles (id, title, url, source, publishedAt, isoA2, severity, geocodePrecision, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET title=excluded.title, severity=excluded.severity, payload=excluded.payload`
  );
  for (const a of articles) {
    stmt.run(a.id, a.title, a.url, a.source, a.publishedAt, a.isoA2, a.severity, a.geocodePrecision, JSON.stringify(a));
  }
}

export async function readArticles({ since, isoA2 } = {}) {
  const db = ensureDatabase();
  let sql = 'SELECT payload FROM articles WHERE 1=1';
  const params = [];
  if (since) { sql += ' AND publishedAt >= ?'; params.push(since); }
  if (isoA2) { sql += ' AND isoA2 = ?'; params.push(isoA2); }
  sql += ' ORDER BY publishedAt DESC';
  const stmt = prepareStatement(db, sql);
  const rows = stmt.all(...params);
  return rows.map(r => JSON.parse(r.payload));
}

export async function upsertEvent(event) {
  const db = ensureDatabase();
  const stmt = prepareStatement(db,
    `INSERT INTO events (id, title, primaryCountry, countries, lifecycle, severity, category, firstSeenAt, lastUpdatedAt, topicFingerprint, coordinates)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, severity=excluded.severity, lifecycle=excluded.lifecycle,
       lastUpdatedAt=excluded.lastUpdatedAt, countries=excluded.countries,
       topicFingerprint=excluded.topicFingerprint, coordinates=excluded.coordinates`
  );
  stmt.run(event.id, event.title, event.primaryCountry, event.countries, event.lifecycle,
    event.severity, event.category, event.firstSeenAt, event.lastUpdatedAt,
    event.topicFingerprint, event.coordinates);
}

export async function readActiveEvents({ maxAgeHours = null } = {}) {
  const db = ensureDatabase();
  let sql = `SELECT * FROM events WHERE lifecycle != 'resolved'`;
  const params = [];
  if (maxAgeHours) {
    sql += ` AND lastUpdatedAt >= ?`;
    params.push(new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString());
  }
  sql += ` ORDER BY lastUpdatedAt DESC`;
  const stmt = prepareStatement(db, sql);
  return stmt.all(...params).map(row => ({
    ...row,
    countries: JSON.parse(row.countries || '[]'),
    topicFingerprint: JSON.parse(row.topicFingerprint || '[]'),
    coordinates: JSON.parse(row.coordinates || 'null')
  }));
}

export async function updateEventLifecycle(eventId, lifecycle) {
  const db = ensureDatabase();
  const stmt = prepareStatement(db, 'UPDATE events SET lifecycle = ? WHERE id = ?');
  stmt.run(lifecycle, eventId);
}

export async function linkArticlesToEvent(eventId, articleIds) {
  const db = ensureDatabase();
  const stmt = prepareStatement(db,
    'INSERT OR IGNORE INTO event_articles (eventId, articleId) VALUES (?, ?)'
  );
  for (const articleId of articleIds) {
    stmt.run(eventId, articleId);
  }
}

export async function readEventArticles(eventId) {
  const db = ensureDatabase();
  const stmt = prepareStatement(db,
    `SELECT a.payload FROM event_articles ea
     JOIN articles a ON a.id = ea.articleId
     WHERE ea.eventId = ?
     ORDER BY a.publishedAt DESC`
  );
  return stmt.all(eventId).map(r => JSON.parse(r.payload));
}

export async function pruneResolvedEvents(maxAgeDays = 30) {
  const db = ensureDatabase();
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  prepareStatement(db,
    `DELETE FROM event_articles WHERE eventId IN (SELECT id FROM events WHERE lifecycle = 'resolved' AND lastUpdatedAt < ?)`
  ).run(cutoff);
  prepareStatement(db,
    `DELETE FROM events WHERE lifecycle = 'resolved' AND lastUpdatedAt < ?`
  ).run(cutoff);
}

export async function pruneOrphanedArticles(maxAgeDays = 7) {
  const db = ensureDatabase();
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  prepareStatement(db,
    `DELETE FROM articles WHERE id NOT IN (SELECT articleId FROM event_articles) AND publishedAt < ?`
  ).run(cutoff);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/storage.test.js`
Expected: PASS — all tests including the new table tests.

- [ ] **Step 6: Commit**

```bash
git add server/storage.js test/storage.test.js
git commit -m "feat: add articles, events, event_articles tables to SQLite storage"
```

---

### Task 4: Create eventStore.js — server-side event clustering and persistence

**Files:**
- Create: `server/eventStore.js`
- Create: `test/eventStore.test.js`

- [ ] **Step 1: Write failing tests for event merging**

Create `test/eventStore.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';

// eventStore needs a storage backend — we'll inject it
import { mergeArticlesIntoEvents } from '../server/eventStore.js';

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
    ...overrides
  };
}

test('mergeArticlesIntoEvents creates a new event for first article', () => {
  const existingEvents = [];
  const articles = [makeArticle()];
  const result = mergeArticlesIntoEvents(articles, existingEvents);
  assert.equal(result.length, 1);
  assert.ok(result[0].id.startsWith('evt-'));
  assert.equal(result[0].lifecycle, 'emerging');
  assert.equal(result[0].primaryCountry, 'TR');
  assert.equal(result[0].articleIds.length, 1);
});

test('mergeArticlesIntoEvents merges similar articles into same event', () => {
  const existingEvents = [];
  const articles = [
    makeArticle({ title: 'Turkey earthquake kills hundreds in southern region' }),
    makeArticle({ title: 'Earthquake in Turkey leaves hundreds dead' }),
    makeArticle({ title: 'Southern Turkey hit by devastating earthquake' })
  ];
  const result = mergeArticlesIntoEvents(articles, existingEvents);
  assert.equal(result.length, 1);
  assert.equal(result[0].articleIds.length, 3);
});

test('mergeArticlesIntoEvents keeps separate events for different topics', () => {
  const existingEvents = [];
  const articles = [
    makeArticle({ title: 'Turkey earthquake kills hundreds', isoA2: 'TR' }),
    makeArticle({ title: 'Mali conflict escalates amid Wagner deployment', isoA2: 'ML' })
  ];
  const result = mergeArticlesIntoEvents(articles, existingEvents);
  assert.equal(result.length, 2);
});

test('mergeArticlesIntoEvents merges into existing events', () => {
  const existingEvents = [{
    id: 'evt-existing',
    title: 'Turkey earthquake kills hundreds',
    primaryCountry: 'TR',
    countries: ['TR'],
    lifecycle: 'developing',
    severity: 75,
    category: 'Seismic',
    firstSeenAt: new Date(Date.now() - 3600000).toISOString(),
    lastUpdatedAt: new Date(Date.now() - 1800000).toISOString(),
    topicFingerprint: ['earthquake', 'hundreds', 'kills', 'southern', 'turkey'],
    articleIds: ['art-prev1', 'art-prev2']
  }];
  const articles = [
    makeArticle({ title: 'Earthquake death toll rises in Turkey' })
  ];
  const result = mergeArticlesIntoEvents(articles, existingEvents);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'evt-existing'); // same event
  assert.equal(result[0].articleIds.length, 3); // 2 existing + 1 new
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/eventStore.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement mergeArticlesIntoEvents**

Create `server/eventStore.js`:

```javascript
import { tokenizeHeadline, jaccardSimilarity } from '../src/utils/newsPipeline.js';
import {
  generateEventId,
  computeTopicFingerprint,
  computeLifecycleTransition
} from '../src/utils/eventModel.js';

const JACCARD_THRESHOLD = 0.3;
const MATCH_WINDOW_HOURS = 72;

/**
 * Find the best matching event for an article.
 * Returns the event or null if no match.
 */
function findMatchingEvent(article, events) {
  const articleTokens = tokenizeHeadline(article.title);
  let bestMatch = null;
  let bestScore = 0;

  for (const event of events) {
    // Must share at least one country
    const articleCountry = article.isoA2;
    const sharesCountry = event.countries.includes(articleCountry) ||
                          event.primaryCountry === articleCountry;
    if (!sharesCountry) continue;

    // Check age — only match events from last 72h
    const eventAge = Date.now() - new Date(event.lastUpdatedAt).getTime();
    if (eventAge > MATCH_WINDOW_HOURS * 60 * 60 * 1000) continue;

    const score = jaccardSimilarity(articleTokens, event.topicFingerprint);
    if (score >= JACCARD_THRESHOLD && score > bestScore) {
      bestMatch = event;
      bestScore = score;
    }
  }

  return bestMatch;
}

/**
 * Merge a batch of new articles into existing events.
 * Returns the updated event list (existing events modified in place + new events appended).
 *
 * This is a pure function — it does not touch storage.
 * The caller is responsible for persisting the results.
 *
 * @param {Article[]} articles - new articles to merge
 * @param {Event[]} existingEvents - events from the database (mutable)
 * @returns {Event[]} - all events after merging
 */
export function mergeArticlesIntoEvents(articles, existingEvents) {
  const events = existingEvents.map(e => ({ ...e, articleIds: [...(e.articleIds || [])] }));
  const newEvents = [];

  for (const article of articles) {
    const match = findMatchingEvent(article, [...events, ...newEvents]);
    if (match) {
      if (!match.articleIds.includes(article.id)) {
        match.articleIds.push(article.id);
      }
      // Update last updated time
      if (new Date(article.publishedAt) > new Date(match.lastUpdatedAt)) {
        match.lastUpdatedAt = article.publishedAt;
      }
      // Add country if new
      if (article.isoA2 && !match.countries.includes(article.isoA2)) {
        match.countries.push(article.isoA2);
      }
    } else {
      // Create new event
      const fp = computeTopicFingerprint([article]);
      const id = generateEventId(article.isoA2, fp);
      newEvents.push({
        id,
        title: article.title,
        primaryCountry: article.isoA2,
        countries: [article.isoA2],
        lifecycle: 'emerging',
        severity: article.severity || 0,
        category: article.category || 'General',
        firstSeenAt: article.publishedAt || new Date().toISOString(),
        lastUpdatedAt: article.publishedAt || new Date().toISOString(),
        topicFingerprint: fp,
        coordinates: article.coordinates || null,
        articleIds: [article.id],
        sourceTypes: new Set() // populated below
      });
    }
  }

  // Populate sourceTypes for all events (deferred to Phase 2 for full use,
  // but we collect the data now). Requires articles to have source metadata.
  // Note: sourceTypes is a Set of strings like 'wire', 'state', 'independent', 'ngo'.
  // The actual classification uses classifySourceType() from sourceMetadata.js.
  // For now, store as an array for JSON serialization. Phase 2 will use this.

  return [...events, ...newEvents];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/eventStore.test.js`
Expected: PASS — all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add server/eventStore.js test/eventStore.test.js
git commit -m "feat: add eventStore with article-to-event merging logic"
```

---

### Task 5: Integrate event store into server ingest cycle

**Files:**
- Modify: `server/ingest.js` (lines 620-738, `refreshSnapshot()`)
- Modify: `server/storage.js` (use new functions)

- [ ] **Step 1: Add event store imports to ingest.js**

At the top of `server/ingest.js`, add:

```javascript
import { mergeArticlesIntoEvents } from './eventStore.js';
import { computeLifecycleTransition, computeTopicFingerprint } from '../src/utils/eventModel.js';
import {
  upsertArticles,
  upsertEvent,
  linkArticlesToEvent,
  readActiveEvents,
  updateEventLifecycle,
  pruneResolvedEvents,
  pruneOrphanedArticles
} from './storage.js';
```

- [ ] **Step 2: Add event persistence to refreshSnapshot()**

In `server/ingest.js`, inside `refreshSnapshot()`, after `canonicalizeArticles()` is called (around line 664), add the event persistence logic:

```javascript
    // --- Persistent event store ---
    // 1. Persist individual articles
    await upsertArticles(allArticles);

    // 2. Load existing events from DB (only last 72h per spec)
    const existingEvents = await readActiveEvents({ maxAgeHours: 72 });

    // 3. Merge new articles into events
    const mergedEvents = mergeArticlesIntoEvents(allArticles, existingEvents);

    // 4. Update lifecycle for all events
    for (const event of mergedEvents) {
      // Get ALL articles for this event (from DB, not just current batch)
      // so velocity windows are accurate across refresh cycles
      await linkArticlesToEvent(event.id, event.articleIds); // link first so readEventArticles works
      const allEventArticles = await readEventArticles(event.id);
      const now = Date.now();
      const twoHoursAgo = now - 2 * 60 * 60 * 1000;
      const fourHoursAgo = now - 4 * 60 * 60 * 1000;
      const currWindow = allEventArticles.filter(a => new Date(a.publishedAt).getTime() >= twoHoursAgo).length;
      const prevWindow = allEventArticles.filter(a => {
        const t = new Date(a.publishedAt).getTime();
        return t >= fourHoursAgo && t < twoHoursAgo;
      }).length;

      event.lifecycle = computeLifecycleTransition({
        lifecycle: event.lifecycle,
        firstSeenAt: event.firstSeenAt,
        articleCount: event.articleIds.length,
        lastUpdatedAt: event.lastUpdatedAt,
        prevWindowArticleCount: prevWindow,
        currWindowArticleCount: currWindow
      });

      // Recompute severity as max from articles
      if (allEventArticles.length > 0) {
        const severities = allEventArticles.map(a => a.severity || 0);
        event.severity = Math.round(Math.max(...severities) * 0.58 + (severities.reduce((s, v) => s + v, 0) / severities.length) * 0.42);
      }
    }

    // 5. Persist events (links already saved above in step 4)
    for (const event of mergedEvents) {
      await upsertEvent({
        ...event,
        countries: JSON.stringify(event.countries),
        topicFingerprint: JSON.stringify(event.topicFingerprint),
        coordinates: JSON.stringify(event.coordinates)
      });
    }

    // 6. Prune old data
    await pruneResolvedEvents(30);
    await pruneOrphanedArticles(7);

    // Replace canonicalized events with persistent events in the snapshot
    const persistentEvents = mergedEvents.filter(e => e.lifecycle !== 'resolved');
```

Then update the snapshot to use `persistentEvents` instead of the old `events` variable where the snapshot is built. The existing `events` from `canonicalizeArticles()` can be removed from the snapshot — replaced by `persistentEvents`.

- [ ] **Step 3: Update buildBriefing() to include lifecycle in response**

In `server/ingest.js`, inside `buildBriefing()` (around line 219), ensure the `events` field in the response uses the persistent events (which now include `lifecycle`, `firstSeenAt`, `lastUpdatedAt`). The events should also include their `supportingArticles` so the client can render them:

```javascript
    // In buildBriefing, after getting the snapshot:
    // Enrich persistent events with their articles for the response
    const enrichedEvents = (snapshot.events || []).map(evt => {
      const articles = readEventArticles(evt.id);
      return { ...evt, supportingArticles: articles, articleCount: articles.length };
    });
```

And return `enrichedEvents` as the `events` field.

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `node --test`
Expected: All existing tests still pass. The ingest changes are additive — they persist events alongside the existing snapshot flow.

- [ ] **Step 5: Commit**

```bash
git add server/ingest.js
git commit -m "feat: integrate persistent event store into ingest cycle"
```

---

### Task 6: Update briefing API for serverless (Vercel)

**Files:**
- Modify: `api/_lib/fetchBriefing.js`

- [ ] **Step 1: Update serverless briefing to pass through lifecycle fields**

The serverless briefing (`api/_lib/fetchBriefing.js`) does not have persistent storage — it does a fresh fetch each time. The events it returns from `canonicalizeArticles()` lack `lifecycle`, `firstSeenAt`, `lastUpdatedAt`. Add sensible defaults so the client doesn't break:

In `api/_lib/fetchBriefing.js`, after `canonicalizeArticles(allArticles)` is called, map the events to add default lifecycle fields:

```javascript
    const events = canonicalizeArticles(allArticles).map(evt => ({
      ...evt,
      lifecycle: evt.lifecycle || 'developing', // serverless can't track lifecycle
      firstSeenAt: evt.firstSeenAt || evt.publishedAt,
      lastUpdatedAt: evt.lastUpdatedAt || evt.publishedAt
    }));
```

- [ ] **Step 2: Run existing tests**

Run: `node --test`
Expected: PASS — all tests.

- [ ] **Step 3: Commit**

```bash
git add api/_lib/fetchBriefing.js
git commit -m "feat: add lifecycle defaults to serverless briefing response"
```

---

### Task 7: Extract useEventData hook from App.jsx

**Files:**
- Create: `src/hooks/useEventData.js`
- Modify: `src/App.jsx`

- [ ] **Step 1: Create useEventData hook**

Create `src/hooks/useEventData.js`. Extract the data fetching logic from App.jsx (`loadLiveData`, refresh timer, briefing state) into a custom hook:

```javascript
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchBackendBriefing,
  fetchBackendCoverageHistory,
  fetchBackendHealth,
  refreshBackendBriefing
} from '../services/backendService';
import { fetchLiveNews, getGdeltFetchHealth } from '../services/gdeltService';
import { MOCK_NEWS } from '../utils/mockData';

const REFRESH_INTERVAL = 5 * 60 * 1000;

export function useEventData() {
  const [events, setEvents] = useState([]);
  const [rawArticles, setRawArticles] = useState([]);
  const [sourceHealth, setSourceHealth] = useState(null);
  const [coverageTrends, setCoverageTrends] = useState(null);
  const [coverageHistory, setCoverageHistory] = useState(null);
  const [opsHealth, setOpsHealth] = useState(null);
  const [dataSource, setDataSource] = useState('loading');
  const [lastRefresh, setLastRefresh] = useState(null);
  const refreshTimerRef = useRef(null);
  const prevArticleCountRef = useRef(0);
  const isFirstLoadRef = useRef(true);

  const loadLiveData = useCallback(async (forceRefresh = false) => {
    try {
      const briefing = forceRefresh
        ? await refreshBackendBriefing()
        : await fetchBackendBriefing();

      if (briefing?.events || briefing?.articles) {
        setEvents(briefing.events || []);
        setRawArticles(briefing.articles || []);
        setSourceHealth(briefing.sourceHealth || null);
        setCoverageTrends(briefing.coverageTrends || null);
        setOpsHealth(briefing.ingestHealth || null);
        setDataSource('live');
        setLastRefresh(new Date());

        const newCount = (briefing.events || briefing.articles || []).length;
        const prevCount = prevArticleCountRef.current;
        prevArticleCountRef.current = newCount;
        isFirstLoadRef.current = false;

        return { isNew: !isFirstLoadRef.current && newCount > prevCount, newCount, prevCount };
      }
    } catch {
      // Backend failed — try client-side GDELT
    }

    try {
      const result = await fetchLiveNews({ timespan: '24h', maxRecords: 250 });
      if (result?.articles?.length) {
        setRawArticles(result.articles);
        setEvents([]); // client-side GDELT doesn't produce events
        setSourceHealth({ gdelt: getGdeltFetchHealth() });
        setCoverageTrends(null);
        setOpsHealth(null);
        setDataSource('live');
        setLastRefresh(new Date());
        return {};
      }
    } catch {
      // GDELT also failed
    }

    // Final fallback: mock data
    setRawArticles(MOCK_NEWS);
    setEvents([]);
    setDataSource('mock');
    setLastRefresh(new Date());
    return {};
  }, []);

  // Initial load + refresh timer
  useEffect(() => {
    loadLiveData();
    refreshTimerRef.current = setInterval(() => loadLiveData(), REFRESH_INTERVAL);
    return () => clearInterval(refreshTimerRef.current);
  }, [loadLiveData]);

  const refresh = useCallback(() => loadLiveData(true), [loadLiveData]);

  return {
    events, rawArticles, sourceHealth, coverageTrends, coverageHistory,
    opsHealth, dataSource, lastRefresh, refresh
  };
}
```

- [ ] **Step 2: Update App.jsx to use the hook**

In `src/App.jsx`:
1. Import `useEventData` from `../hooks/useEventData`
2. Replace the `loadLiveData` function, `refreshTimerRef`, `prevArticleCountRef`, `isFirstLoadRef`, and related useState calls with a single `const { events, rawArticles, sourceHealth, ... } = useEventData()`
3. The rest of App.jsx (filtering, sorting, region selection) continues to work on the data from the hook

The key change: where App.jsx currently runs `canonicalizeArticles(baseArticles)` to produce events client-side, it should prefer server-provided `events` when available:

```javascript
const canonicalNews = useMemo(() => {
  // If server provided persistent events, use those
  if (events.length > 0) return events;
  // Otherwise fall back to client-side canonicalization
  return canonicalizeArticles(baseArticles);
}, [events, baseArticles]);
```

- [ ] **Step 3: Verify the app still works**

Run: `npm run dev:frontend`
Open the app in a browser. Verify:
- Map still loads with events/dots
- NewsPanel still shows stories
- Filters still work
- No console errors

- [ ] **Step 4: Run existing tests**

Run: `node --test`
Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useEventData.js src/App.jsx
git commit -m "refactor: extract useEventData hook from App.jsx"
```

---

### Task 8: Add lifecycle badge to NewsPanel

**Files:**
- Modify: `src/components/NewsPanel.jsx`
- Modify: `src/index.css`

- [ ] **Step 1: Add lifecycle badge component to NewsPanel**

In `src/components/NewsPanel.jsx`, add a helper function and render it on each event card:

```javascript
const LIFECYCLE_COLORS = {
  emerging: '#00d4ff',
  developing: '#00e5a0',
  escalating: '#ff5555',
  stabilizing: '#ffaa00',
  resolved: '#666'
};

function LifecycleBadge({ lifecycle }) {
  if (!lifecycle) return null;
  return (
    <span
      className="lifecycle-badge"
      style={{ color: LIFECYCLE_COLORS[lifecycle] || '#666', borderColor: LIFECYCLE_COLORS[lifecycle] || '#666' }}
    >
      {lifecycle}
    </span>
  );
}
```

Then in the event card rendering, add `<LifecycleBadge lifecycle={story.lifecycle} />` next to the severity badge.

- [ ] **Step 2: Add CSS for lifecycle badge**

Add to `src/index.css`:

```css
.lifecycle-badge {
  font-size: 0.55rem;
  font-family: 'JetBrains Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 1px 5px;
  border: 1px solid;
  border-radius: 2px;
  white-space: nowrap;
}
```

- [ ] **Step 3: Show article count on event cards**

In the event card, add the article/source count to the meta line:

```javascript
{story.articleCount > 1 && (
  <span className="event-source-count">{story.articleCount} sources</span>
)}
```

- [ ] **Step 4: Add expandable supporting articles list**

When an event card is expanded, show its `supportingArticles` as an evidence list below the main story detail. Reuse the existing expand/collapse pattern already in NewsPanel:

```javascript
{expanded && story.supportingArticles?.length > 1 && (
  <div className="event-evidence">
    <div className="event-evidence-header">{story.supportingArticles.length} sources reporting</div>
    {story.supportingArticles.map((article, i) => (
      <div key={article.id || i} className="event-evidence-item">
        <span className="event-evidence-source">{article.source}</span>
        <a href={article.url} target="_blank" rel="noopener noreferrer" className="event-evidence-title">
          {article.title}
        </a>
        <span className="event-evidence-time">{safeTimeAgo(article.publishedAt)}</span>
      </div>
    ))}
  </div>
)}
```

Add CSS for the evidence list:

```css
.event-evidence { margin-top: 8px; border-top: 1px solid #1a2030; padding-top: 8px; }
.event-evidence-header { font-size: 0.55rem; text-transform: uppercase; color: #666; letter-spacing: 0.5px; margin-bottom: 6px; }
.event-evidence-item { display: flex; gap: 8px; align-items: baseline; font-size: 0.65rem; color: #888; padding: 2px 0; }
.event-evidence-source { color: #00d4ff; white-space: nowrap; min-width: 60px; }
.event-evidence-title { color: #aaa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.event-evidence-title:hover { color: #fff; }
.event-evidence-time { color: #555; white-space: nowrap; margin-left: auto; }
```

- [ ] **Step 5: Verify visual changes**

Run: `npm run dev:frontend`
Verify: lifecycle badges appear, article counts show, expanding an event card reveals the supporting articles list.

- [ ] **Step 5: Commit**

```bash
git add src/components/NewsPanel.jsx src/index.css
git commit -m "feat: add lifecycle badge and source count to event cards"
```

---

### Task 9: Update Globe and FlatMap to render events with size encoding

**Files:**
- Modify: `src/components/Globe.jsx`
- Modify: `src/components/FlatMap.jsx`

- [ ] **Step 1: Update Globe.jsx marker sizing**

In `src/components/Globe.jsx`, where markers are rendered, update the dot size to reflect `articleCount`:

```javascript
// In the labels/markers rendering, scale size by article count
const markerSize = Math.min(0.6, 0.15 + (story.articleCount || 1) * 0.05);

// Ensure dot color encodes severity (per spec: "Color = severity")
// The existing severity color mapping (getSeverityMeta) already handles this,
// but verify that event severity is being passed through, not just article severity.
```

Add lifecycle to the hover tooltip so the analyst sees event state at a glance.

- [ ] **Step 2: Update FlatMap.jsx marker sizing**

In `src/components/FlatMap.jsx`, update the circle layer paint to scale by `articleCount`:

In the GeoJSON source data for article markers, include `articleCount` as a property. Then in the circle layer paint:

```javascript
'circle-radius': [
  'interpolate', ['linear'],
  ['get', 'articleCount'],
  1, 4,    // 1 source = 4px
  5, 7,    // 5 sources = 7px
  10, 10,  // 10 sources = 10px
  20, 14   // 20+ sources = 14px
]
```

- [ ] **Step 3: Update Globe.jsx arc derivation**

Update arc generation to use events' `countries` arrays instead of article headline overlap. Events with 2+ countries in their `countries` array automatically generate arcs.

- [ ] **Step 4: Verify visual changes**

Run: `npm run dev:frontend`
Verify:
- Globe: dots sized by source count, lifecycle in tooltip
- FlatMap: circles sized by source count
- Arcs connect multi-country events

- [ ] **Step 5: Commit**

```bash
git add src/components/Globe.jsx src/components/FlatMap.jsx
git commit -m "feat: scale map markers by article count, derive arcs from event countries"
```

---

### Task 10: Update ArcPanel for event-based arcs

**Files:**
- Modify: `src/components/ArcPanel.jsx`

- [ ] **Step 1: Update ArcPanel to show event context**

ArcPanel currently shows shared articles between two countries based on headline overlap. Update it to show the event(s) that connect two countries:

- When an arc is selected, find events whose `countries` array contains both arc endpoints
- Display those events as the "shared intel" instead of the old article co-mention logic
- Each event card shows its lifecycle badge, article count, and is expandable to show supporting articles

- [ ] **Step 2: Verify visual changes**

Run: `npm run dev:frontend`
Verify: clicking an arc between two countries shows the event(s) connecting them with lifecycle badges.

- [ ] **Step 3: Commit**

```bash
git add src/components/ArcPanel.jsx
git commit -m "feat: update ArcPanel to show event-based connections"
```

---

### Task 11: Update intel ticker for lifecycle changes

**Files:**
- Create: `src/utils/lifecycleMessages.js`
- Test: `test/lifecycleMessages.test.js`
- Modify: `src/App.jsx` (or the component that renders the intel ticker)

- [ ] **Step 1: Write failing test for lifecycle message generation**

Create `test/lifecycleMessages.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLifecycleMessages } from '../src/utils/lifecycleMessages.js';

test('generates messages for lifecycle transitions', () => {
  const current = [
    { id: 'evt-1', title: 'Turkey earthquake', lifecycle: 'escalating', severity: 85 },
    { id: 'evt-2', title: 'Mali conflict', lifecycle: 'developing', severity: 70 }
  ];
  const previous = [
    { id: 'evt-1', title: 'Turkey earthquake', lifecycle: 'developing', severity: 80 },
    { id: 'evt-2', title: 'Mali conflict', lifecycle: 'developing', severity: 70 }
  ];
  const messages = generateLifecycleMessages(current, previous);
  assert.equal(messages.length, 1);
  assert.ok(messages[0].text.includes('Turkey earthquake'));
  assert.ok(messages[0].text.includes('escalating'));
  assert.equal(messages[0].lifecycle, 'escalating');
});

test('returns empty array when no transitions', () => {
  const events = [{ id: 'evt-1', title: 'Test', lifecycle: 'developing', severity: 50 }];
  assert.deepEqual(generateLifecycleMessages(events, events), []);
});

test('ignores new events with no previous state', () => {
  const current = [{ id: 'evt-new', title: 'New event', lifecycle: 'emerging', severity: 40 }];
  assert.deepEqual(generateLifecycleMessages(current, []), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/lifecycleMessages.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement generateLifecycleMessages**

Create `src/utils/lifecycleMessages.js`:

```javascript
/**
 * Compare current and previous event lists, return messages for lifecycle transitions.
 */
export function generateLifecycleMessages(currentEvents, previousEvents) {
  const prevMap = new Map(previousEvents.map(e => [e.id, e]));
  const messages = [];
  for (const event of currentEvents) {
    const prev = prevMap.get(event.id);
    if (prev && prev.lifecycle !== event.lifecycle) {
      messages.push({
        text: `${event.title} → ${event.lifecycle}`,
        severity: event.severity,
        lifecycle: event.lifecycle
      });
    }
  }
  return messages;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/lifecycleMessages.test.js`
Expected: PASS — all 3 tests.

- [ ] **Step 5: Feed lifecycle messages into the intel ticker**

In `src/App.jsx`, import `generateLifecycleMessages` and use it in the refresh cycle. Store previous events in a ref, compare after each load, and prepend lifecycle messages to the ticker data.

- [ ] **Step 6: Verify**

Run: `npm run dev:frontend`
Verify: ticker shows lifecycle transition messages.

- [ ] **Step 7: Commit**

```bash
git add src/utils/lifecycleMessages.js test/lifecycleMessages.test.js src/App.jsx
git commit -m "feat: show event lifecycle transitions in intel ticker"
```

---

### Task 12: Final integration test and cleanup

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `node --test`
Expected: All tests pass.

- [ ] **Step 2: Manual smoke test**

Start the full dev environment:
```bash
npm run dev
```

Verify end-to-end:
1. Server starts, ingests data, persists events to SQLite
2. Frontend loads, shows events with lifecycle badges
3. Map dots sized by article count
4. Arcs connect multi-country events
5. NewsPanel shows events with expandable article lists
6. Intel ticker shows lifecycle changes
7. Refresh cycle updates events without losing state (events persist!)

- [ ] **Step 3: Check SQLite for persisted events**

```bash
node -e "
import('./server/storage.js').then(s => {
  const events = s.readActiveEvents();
  console.log('Active events:', events.length);
  events.slice(0, 3).forEach(e => console.log(e.id, e.lifecycle, e.title.slice(0, 50)));
})
"
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: Phase 1 Event Engine complete — persistent events with lifecycle tracking"
```
