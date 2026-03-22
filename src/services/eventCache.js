/**
 * eventCache.js — IndexedDB snapshot storage and diff engine
 *
 * Two distinct parts:
 *  1. Pure diff functions — work in Node (no browser APIs needed)
 *  2. IndexedDB operations — browser-only, guarded by typeof indexedDB checks
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAME = 'mapr-event-cache';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Lifecycle stages ordered from least to most severe — used to detect escalation */
const LIFECYCLE_ORDER = ['emerging', 'developing', 'escalating', 'critical', 'resolved'];

// ---------------------------------------------------------------------------
// Pure diff functions (testable in Node)
// ---------------------------------------------------------------------------

/**
 * Compare two arrays of event objects and return a structured diff.
 *
 * @param {Array<{id: string, lifecycle: string, severity?: number}>} previousEvents
 * @param {Array<{id: string, lifecycle: string, severity?: number}>} currentEvents
 * @returns {{
 *   newEvents: Array,
 *   escalated: Array,
 *   resolved: Array,
 *   lifecycleChanges: Array<{previous: object, current: object}>,
 *   isFirstVisit: boolean
 * }}
 */
export function diffEventSnapshots(previousEvents, currentEvents) {
  const isFirstVisit = previousEvents.length === 0;

  const previousById = new Map(previousEvents.map(e => [e.id, e]));
  const currentById = new Map(currentEvents.map(e => [e.id, e]));

  const newEvents = [];
  const escalated = [];
  const lifecycleChanges = [];

  for (const current of currentEvents) {
    const previous = previousById.get(current.id);
    if (!previous) {
      newEvents.push(current);
      continue;
    }

    if (previous.lifecycle !== current.lifecycle) {
      lifecycleChanges.push({ previous, current });

      const prevRank = LIFECYCLE_ORDER.indexOf(previous.lifecycle);
      const currRank = LIFECYCLE_ORDER.indexOf(current.lifecycle);
      // Consider it escalated if the lifecycle moved forward (higher index) toward critical
      if (currRank > prevRank && current.lifecycle !== 'resolved') {
        escalated.push(current);
      }
    }
  }

  const resolved = previousEvents.filter(e => !currentById.has(e.id));

  return { newEvents, escalated, resolved, lifecycleChanges, isFirstVisit };
}

/**
 * Convert a diff result into a human-readable summary string.
 *
 * @param {{
 *   newEvents: Array,
 *   escalated: Array,
 *   resolved: Array,
 *   lifecycleChanges: Array,
 *   isFirstVisit: boolean
 * }} diff
 * @returns {string}
 */
export function buildSnapshotSummary(diff) {
  if (diff.isFirstVisit) {
    const count = diff.newEvents.length;
    return `First visit — tracking ${count} event${count !== 1 ? 's' : ''}.`;
  }

  const parts = [];

  if (diff.newEvents.length > 0) {
    parts.push(`${diff.newEvents.length} new`);
  }
  if (diff.escalated.length > 0) {
    parts.push(`${diff.escalated.length} escalated`);
  }
  if (diff.resolved.length > 0) {
    parts.push(`${diff.resolved.length} resolved`);
  }
  if (diff.lifecycleChanges.length > 0 && diff.escalated.length === 0) {
    parts.push(`${diff.lifecycleChanges.length} updated`);
  }

  if (parts.length === 0) {
    return 'No changes since last visit.';
  }

  return parts.join(', ') + ' since last visit.';
}

// ---------------------------------------------------------------------------
// IndexedDB helpers (browser-only)
// ---------------------------------------------------------------------------

/**
 * Open (or upgrade) the IndexedDB database.
 * Returns a Promise<IDBDatabase> or rejects if IndexedDB is unavailable.
 */
function openDB() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this environment.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'timestamp' });
        store.createIndex('timestamp', 'timestamp', { unique: true });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Save a snapshot of the current event list to IndexedDB.
 * No-op when IndexedDB is unavailable.
 *
 * @param {Array} events — current list of event objects
 * @returns {Promise<void>}
 */
export async function saveSnapshot(events) {
  if (typeof indexedDB === 'undefined') return;

  const db = await openDB();
  const snapshot = {
    timestamp: Date.now(),
    savedAt: new Date().toISOString(),
    events: events.map(e => ({ id: e.id, lifecycle: e.lifecycle, severity: e.severity }))
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(snapshot);
    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Load the most recent snapshot from IndexedDB.
 * Returns null when IndexedDB is unavailable or no snapshot exists.
 *
 * @returns {Promise<{timestamp: number, savedAt: string, events: Array}|null>}
 */
export async function loadLastSnapshot() {
  if (typeof indexedDB === 'undefined') return null;

  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    // Open cursor in descending order to get the most recent record first
    const request = store.index('timestamp').openCursor(null, 'prev');

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      resolve(cursor ? cursor.value : null);
      db.close();
    };
    request.onerror = (event) => {
      db.close();
      reject(event.target.error);
    };
  });
}

/**
 * Load all snapshots from IndexedDB, ordered oldest-first.
 * Useful for timeline scrubbing.
 *
 * @returns {Promise<Array<{timestamp: number, savedAt: string, events: Array}>>}
 */
export async function loadSnapshotHistory() {
  if (typeof indexedDB === 'undefined') return [];

  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = (event) => {
      const results = event.target.result || [];
      results.sort((a, b) => a.timestamp - b.timestamp);
      resolve(results);
      db.close();
    };
    request.onerror = (event) => {
      db.close();
      reject(event.target.error);
    };
  });
}

/**
 * Delete snapshots older than MAX_SNAPSHOT_AGE_MS (7 days) from IndexedDB.
 * No-op when IndexedDB is unavailable.
 *
 * @returns {Promise<void>}
 */
export async function pruneOldSnapshots() {
  if (typeof indexedDB === 'undefined') return;

  const db = await openDB();
  const cutoff = Date.now() - MAX_SNAPSHOT_AGE_MS;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    // IDBKeyRange.upperBound selects all keys <= cutoff (i.e. older entries)
    const range = IDBKeyRange.upperBound(cutoff);
    const request = store.index('timestamp').openCursor(range);

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    request.onerror = (event) => reject(event.target.error);

    tx.oncomplete = () => {
      resolve();
      db.close();
    };
    tx.onerror = (event) => {
      db.close();
      reject(event.target.error);
    };
  });
}
