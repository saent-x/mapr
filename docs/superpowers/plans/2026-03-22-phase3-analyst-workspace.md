# Phase 3: Analyst Workspace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Session memory, saved views, change tracking, timeline, briefing export, and URL state. Turn Mapr into a daily driver for a solo OSINT analyst.

**Architecture:** All client-side — no backend changes needed. IndexedDB for event snapshots (session memory + timeline data). localStorage for saved views. URL query params for deep linking. Browser print-to-PDF for export.

**Tech Stack:** IndexedDB (via `idb-keyval` or raw API), localStorage, react-router-dom (existing), browser print API.

**Spec:** `docs/superpowers/specs/2026-03-22-mapr-pro-osint-upgrade-design.md` — Phase 3 section.

**Depends on:** Phase 1 (persistent events) + Phase 2 (entity intelligence) — both complete.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/services/eventCache.js` | IndexedDB wrapper for event snapshot storage, diffing, and pruning |
| `src/utils/viewManager.js` | Saved view CRUD, localStorage persistence, URL encoding/decoding |
| `src/components/ViewSwitcher.jsx` | Navbar dropdown for switching between saved views |
| `src/components/EventTimeline.jsx` | Horizontal timeline scrubber showing event density over time |
| `src/components/ChangesBanner.jsx` | "4 new events since 6h ago" + lifecycle change summary |
| `src/components/BriefingExport.jsx` | Export dialog for PDF and JSON snapshot |
| `test/eventCache.test.js` | Tests for IndexedDB operations and diff logic |
| `test/viewManager.test.js` | Tests for view CRUD and URL encoding |

### Modified Files

| File | Change |
|------|--------|
| `src/App.jsx` | Integrate view manager, event cache, change detection, timeline state |
| `src/components/Header.jsx` | View switcher + new events badge + export button |
| `src/components/NewsPanel.jsx` | "Changes since last visit" section at top |
| `src/main.jsx` | URL param routing for view state |

---

## Tasks

### Task 1: Create eventCache.js — IndexedDB snapshot storage

**Files:**
- Create: `src/services/eventCache.js`
- Create: `test/eventCache.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/eventCache.test.js`. Note: IndexedDB is not available in Node, so we test the pure diff logic separately and mock the storage layer.

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffEventSnapshots, buildSnapshotSummary } from '../src/services/eventCache.js';

test('diffEventSnapshots detects new events', () => {
  const previous = [{ id: 'evt-1', lifecycle: 'developing', severity: 70 }];
  const current = [
    { id: 'evt-1', lifecycle: 'developing', severity: 70 },
    { id: 'evt-2', lifecycle: 'emerging', severity: 50 }
  ];
  const diff = diffEventSnapshots(previous, current);
  assert.equal(diff.newEvents.length, 1);
  assert.equal(diff.newEvents[0].id, 'evt-2');
  assert.equal(diff.escalated.length, 0);
  assert.equal(diff.resolved.length, 0);
});

test('diffEventSnapshots detects lifecycle escalation', () => {
  const previous = [{ id: 'evt-1', lifecycle: 'developing', severity: 70 }];
  const current = [{ id: 'evt-1', lifecycle: 'escalating', severity: 85 }];
  const diff = diffEventSnapshots(previous, current);
  assert.equal(diff.escalated.length, 1);
  assert.equal(diff.escalated[0].id, 'evt-1');
  assert.equal(diff.escalated[0].previousLifecycle, 'developing');
});

test('diffEventSnapshots detects resolved events', () => {
  const previous = [
    { id: 'evt-1', lifecycle: 'developing', severity: 70 },
    { id: 'evt-2', lifecycle: 'escalating', severity: 85 }
  ];
  const current = [{ id: 'evt-1', lifecycle: 'developing', severity: 70 }];
  const diff = diffEventSnapshots(previous, current);
  assert.equal(diff.resolved.length, 1);
  assert.equal(diff.resolved[0].id, 'evt-2');
});

test('diffEventSnapshots handles empty previous (first visit)', () => {
  const current = [{ id: 'evt-1', lifecycle: 'emerging', severity: 50 }];
  const diff = diffEventSnapshots([], current);
  assert.equal(diff.newEvents.length, 1);
  assert.equal(diff.isFirstVisit, true);
});

test('buildSnapshotSummary creates human-readable summary', () => {
  const diff = {
    newEvents: [{ id: 'evt-1', title: 'Test' }],
    escalated: [],
    resolved: [{ id: 'evt-2', title: 'Old' }],
    lifecycleChanges: [],
    isFirstVisit: false,
    previousSnapshotAge: 3600000
  };
  const summary = buildSnapshotSummary(diff);
  assert.ok(summary.includes('1 new'));
  assert.ok(summary.includes('1 resolved'));
});
```

- [ ] **Step 2: Implement eventCache.js**

Create `src/services/eventCache.js`:

```javascript
const DB_NAME = 'mapr-event-cache';
const STORE_NAME = 'snapshots';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Diff two event snapshots to find changes.
 * Pure function — no IndexedDB dependency.
 */
export function diffEventSnapshots(previousEvents, currentEvents) {
  const prevMap = new Map((previousEvents || []).map(e => [e.id, e]));
  const currMap = new Map(currentEvents.map(e => [e.id, e]));
  const isFirstVisit = !previousEvents || previousEvents.length === 0;

  const newEvents = currentEvents.filter(e => !prevMap.has(e.id));

  const escalated = [];
  const lifecycleChanges = [];
  for (const event of currentEvents) {
    const prev = prevMap.get(event.id);
    if (prev && prev.lifecycle !== event.lifecycle) {
      lifecycleChanges.push({ ...event, previousLifecycle: prev.lifecycle });
      if (event.lifecycle === 'escalating' && prev.lifecycle !== 'escalating') {
        escalated.push({ ...event, previousLifecycle: prev.lifecycle });
      }
    }
  }

  const resolved = (previousEvents || []).filter(e =>
    !currMap.has(e.id) || currMap.get(e.id)?.lifecycle === 'resolved'
  );

  const previousSnapshotAge = previousEvents?._snapshotAt
    ? Date.now() - new Date(previousEvents._snapshotAt).getTime()
    : null;

  return { newEvents, escalated, resolved, lifecycleChanges, isFirstVisit, previousSnapshotAge };
}

/**
 * Build a human-readable summary of changes.
 */
export function buildSnapshotSummary(diff) {
  const parts = [];
  if (diff.newEvents.length) parts.push(`${diff.newEvents.length} new`);
  if (diff.escalated.length) parts.push(`${diff.escalated.length} escalated`);
  if (diff.resolved.length) parts.push(`${diff.resolved.length} resolved`);
  if (diff.lifecycleChanges.length) parts.push(`${diff.lifecycleChanges.length} changed`);
  if (parts.length === 0) return 'No changes since last visit';
  return parts.join(', ');
}

/**
 * IndexedDB operations — only work in browser environment.
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSnapshot(events) {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.put({ id: 'latest', events, savedAt: new Date().toISOString() });
  store.put({
    id: `history-${Date.now()}`,
    events: events.map(e => ({ id: e.id, lifecycle: e.lifecycle, severity: e.severity, title: e.title, isoA2: e.isoA2 })),
    savedAt: new Date().toISOString()
  });
  return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
}

export async function loadLastSnapshot() {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const request = store.get('latest');
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}

export async function loadSnapshotHistory() {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const request = store.getAll();
  return new Promise((resolve) => {
    request.onsuccess = () => {
      const all = request.result || [];
      resolve(all.filter(s => s.id.startsWith('history-')).sort((a, b) =>
        new Date(b.savedAt) - new Date(a.savedAt)
      ));
    };
    request.onerror = () => resolve([]);
  });
}

export async function pruneOldSnapshots() {
  if (typeof indexedDB === 'undefined') return;
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const request = store.getAll();
  return new Promise((resolve) => {
    request.onsuccess = () => {
      for (const entry of request.result || []) {
        if (entry.id !== 'latest' && entry.savedAt < cutoff) {
          store.delete(entry.id);
        }
      }
      resolve();
    };
    request.onerror = () => resolve();
  });
}
```

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git add src/services/eventCache.js test/eventCache.test.js
git commit -m "feat: add event cache with IndexedDB snapshots and diff engine"
```

---

### Task 2: Create viewManager.js — saved views and URL encoding

**Files:**
- Create: `src/utils/viewManager.js`
- Create: `test/viewManager.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createView, encodeViewToURL, decodeURLToFilters, serializeViews, deserializeViews
} from '../src/utils/viewManager.js';

test('createView generates a view with id and timestamps', () => {
  const view = createView('Sahel Watch', {
    searchQuery: 'sahel', dateWindow: '168h', minSeverity: 50
  }, { mapMode: 'flat' });
  assert.ok(view.id);
  assert.equal(view.name, 'Sahel Watch');
  assert.equal(view.filters.searchQuery, 'sahel');
  assert.equal(view.mapState.mapMode, 'flat');
  assert.ok(view.createdAt);
});

test('encodeViewToURL produces query string', () => {
  const url = encodeViewToURL({
    filters: { searchQuery: 'wagner', minSeverity: 60, selectedRegion: 'ML' },
    mapState: { mapMode: 'flat', mapOverlay: 'severity' }
  });
  assert.ok(url.includes('q=wagner'));
  assert.ok(url.includes('severity=60'));
  assert.ok(url.includes('region=ML'));
  assert.ok(url.includes('mode=flat'));
});

test('decodeURLToFilters parses query string', () => {
  const params = new URLSearchParams('q=wagner&severity=60&region=ML&mode=flat');
  const { filters, mapState } = decodeURLToFilters(params);
  assert.equal(filters.searchQuery, 'wagner');
  assert.equal(filters.minSeverity, 60);
  assert.equal(filters.selectedRegion, 'ML');
  assert.equal(mapState.mapMode, 'flat');
});

test('serializeViews and deserializeViews are symmetric', () => {
  const views = [createView('Test', { searchQuery: 'test' }, {})];
  const json = serializeViews(views);
  const parsed = deserializeViews(json);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'Test');
});
```

- [ ] **Step 2: Implement viewManager.js**

```javascript
export function createView(name, filters = {}, mapState = {}) {
  return {
    id: `view-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    filters: { searchQuery: '', dateWindow: '168h', minSeverity: 0, minConfidence: 0,
      sortMode: 'severity', selectedRegion: null, ...filters },
    mapState: { mapMode: 'globe', mapOverlay: 'severity', ...mapState },
    pinnedEventIds: [],
    createdAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString()
  };
}

const URL_PARAM_MAP = {
  q: 'searchQuery', severity: 'minSeverity', confidence: 'minConfidence',
  window: 'dateWindow', sort: 'sortMode', region: 'selectedRegion',
  mode: 'mapMode', overlay: 'mapOverlay', entity: 'entityFilter'
};

export function encodeViewToURL(view) {
  const params = new URLSearchParams();
  const { filters = {}, mapState = {} } = view;
  for (const [param, key] of Object.entries(URL_PARAM_MAP)) {
    const val = filters[key] ?? mapState[key];
    if (val != null && val !== '' && val !== 0) params.set(param, String(val));
  }
  return params.toString();
}

export function decodeURLToFilters(searchParams) {
  const filters = {};
  const mapState = {};
  for (const [param, key] of Object.entries(URL_PARAM_MAP)) {
    const val = searchParams.get(param);
    if (val == null) continue;
    if (['mapMode', 'mapOverlay'].includes(key)) {
      mapState[key] = val;
    } else if (['minSeverity', 'minConfidence'].includes(key)) {
      filters[key] = Number(val);
    } else {
      filters[key] = val;
    }
  }
  return { filters, mapState };
}

const STORAGE_KEY = 'mapr-saved-views';

export function loadViews() {
  try { return deserializeViews(localStorage.getItem(STORAGE_KEY)); }
  catch { return []; }
}

export function saveViews(views) {
  localStorage.setItem(STORAGE_KEY, serializeViews(views));
}

export function serializeViews(views) { return JSON.stringify(views); }
export function deserializeViews(json) {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git add src/utils/viewManager.js test/viewManager.test.js
git commit -m "feat: add view manager with saved views and URL state encoding"
```

---

### Task 3: Create ChangesBanner.jsx

**Files:**
- Create: `src/components/ChangesBanner.jsx`
- Modify: `src/index.css`

- [ ] **Step 1: Implement ChangesBanner**

A compact banner showing what changed since last visit. Shown at top of NewsPanel.

```javascript
// Props: { diff, onDismiss }
// diff = { newEvents, escalated, resolved, lifecycleChanges, isFirstVisit, previousSnapshotAge }
// Shows: "4 new events, 2 escalated since 6h ago" with a dismiss X
// Clicking an event in the list selects it
```

- [ ] **Step 2: Add CSS**

- [ ] **Step 3: Commit**

```bash
git add src/components/ChangesBanner.jsx src/index.css
git commit -m "feat: add changes banner showing what changed since last visit"
```

---

### Task 4: Create ViewSwitcher.jsx

**Files:**
- Create: `src/components/ViewSwitcher.jsx`
- Modify: `src/index.css`

- [ ] **Step 1: Implement ViewSwitcher**

Compact navbar dropdown showing saved views. Props: `{ views, activeViewId, onSelect, onSave, onDelete }`.

- Dropdown with list of saved views (colored dot + name)
- "+" button to save current state
- Click a view to load it
- Small "x" to delete a view
- Shows "No saved views" when empty

- [ ] **Step 2: Add CSS**

- [ ] **Step 3: Commit**

```bash
git add src/components/ViewSwitcher.jsx src/index.css
git commit -m "feat: add view switcher dropdown for saved situation views"
```

---

### Task 5: Create EventTimeline.jsx

**Files:**
- Create: `src/components/EventTimeline.jsx`
- Modify: `src/index.css`

- [ ] **Step 1: Implement EventTimeline**

Horizontal timeline bar showing event density over time. Sits above the intel ticker at the bottom.

Props: `{ events, snapshotHistory, onScrub }`

- Divides 7-day window into ~50 time buckets
- Each bucket = a vertical bar, height = event count in that bucket
- Bar color = predominant lifecycle state in that bucket
- Draggable playhead
- `onScrub(timestamp)` callback — parent filters events to that point in time
- Falls back gracefully when snapshotHistory is empty (shows only current events)

- [ ] **Step 2: Add CSS**

- [ ] **Step 3: Commit**

```bash
git add src/components/EventTimeline.jsx src/index.css
git commit -m "feat: add event timeline scrubber component"
```

---

### Task 6: Create BriefingExport.jsx

**Files:**
- Create: `src/components/BriefingExport.jsx`
- Modify: `src/index.css`

- [ ] **Step 1: Implement BriefingExport**

Modal dialog with two export options. Props: `{ events, filters, onClose }`.

**JSON export:**
```javascript
function exportJSON(events, filters) {
  const payload = {
    exportedAt: new Date().toISOString(),
    filters,
    eventCount: events.length,
    events: events.map(e => ({
      id: e.id, title: e.title, severity: e.severity, lifecycle: e.lifecycle,
      countries: e.countries, entities: e.entities, confidence: e.confidence,
      articleCount: e.articleCount, firstSeenAt: e.firstSeenAt
    }))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `mapr-briefing-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
}
```

**PDF export:**
```javascript
function exportPDF() {
  window.print(); // Uses @media print CSS to style the briefing view
}
```

Add `@media print` CSS rules that hide the map, sidebar, header and show a clean briefing layout.

- [ ] **Step 2: Add CSS (including @media print)**

- [ ] **Step 3: Commit**

```bash
git add src/components/BriefingExport.jsx src/index.css
git commit -m "feat: add briefing export with JSON download and print-to-PDF"
```

---

### Task 7: Integrate everything into App.jsx

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/Header.jsx`
- Modify: `src/components/NewsPanel.jsx`

- [ ] **Step 1: Add session memory (event cache)**

In App.jsx:
- Import `saveSnapshot`, `loadLastSnapshot`, `diffEventSnapshots`, `pruneOldSnapshots` from eventCache
- On initial load: load last snapshot, diff against fresh data, store diff in state
- After each data refresh: save current events as new snapshot, prune old ones
- Pass `diff` to ChangesBanner in NewsPanel

- [ ] **Step 2: Add saved views**

In App.jsx:
- Import `loadViews`, `saveViews`, `createView`, `decodeURLToFilters`, `encodeViewToURL` from viewManager
- Load saved views from localStorage on mount
- When a view is selected: apply its filters and map state
- When "save" is clicked: create a new view from current state
- Pass view props to ViewSwitcher in Header

- [ ] **Step 3: Add URL state sync**

In App.jsx or a new `useURLState` hook:
- On mount: read URL query params, apply to state if present
- On filter/map state change: update URL (replaceState, not pushState, to avoid cluttering history)
- Use `useSearchParams` from react-router-dom

- [ ] **Step 4: Add timeline state**

In App.jsx:
- `timelineScrubTime` state (null = live, Date = historical)
- When scrubbing: filter events by `firstSeenAt <= scrubTime`
- Pass to EventTimeline component

- [ ] **Step 5: Update Header.jsx**

- Add ViewSwitcher to navbar
- Add new events badge (from diff state)
- Add export button that opens BriefingExport modal

- [ ] **Step 6: Update NewsPanel.jsx**

- Add ChangesBanner at top (shows diff from session memory)
- Dismiss hides the banner for this session

- [ ] **Step 7: Run tests, build check**

```bash
node --test && npx vite build
```

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx src/components/Header.jsx src/components/NewsPanel.jsx
git commit -m "feat: integrate session memory, saved views, URL state, and timeline into App"
```

---

### Task 8: Update main.jsx for URL routing

**Files:**
- Modify: `src/main.jsx`

- [ ] **Step 1: Ensure URL params pass through to App**

The existing `main.jsx` uses react-router-dom with `BrowserRouter`, `Routes`, `Route`. Ensure the `*` route passes URL search params to App. This may already work — verify and add `useSearchParams` integration if needed.

- [ ] **Step 2: Commit if changes needed**

```bash
git add src/main.jsx
git commit -m "feat: ensure URL state params pass through router to App"
```

---

### Task 9: Final integration test

**Files:** All

- [ ] **Step 1: Run full test suite**

```bash
node --test
```

- [ ] **Step 2: Build check**

```bash
npx vite build
```

- [ ] **Step 3: Manual verification**

Start dev: `npm run dev`

Verify:
1. First visit: no changes banner (isFirstVisit)
2. Refresh the page: changes banner shows "No changes" or actual diff
3. Save a view: click "+" in ViewSwitcher, name it, verify it appears in dropdown
4. Load a view: select it, verify filters apply
5. URL state: change filters, verify URL updates; copy URL, open in new tab, verify same state
6. Timeline: scrub backward, verify events filter to that time
7. Export JSON: download, verify contents
8. Export PDF: print dialog opens with clean layout

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: Phase 3 Analyst Workspace complete"
```
