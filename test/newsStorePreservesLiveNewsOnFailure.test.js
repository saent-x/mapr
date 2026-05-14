/**
 * Regression: when runLoadLiveDataPipeline returns `kind:'unavailable'`
 * (both backend AND client-GDELT failed for this tick), the store must
 * NOT wipe an existing `liveNews` array. Doing so blanks the map every
 * time a transient network blip lines up with an autoRefresh tick — the
 * exact bug users hit by navigating to /event/:id and back.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const newsStoreSrc = readFileSync(path.join(root, 'src/stores/newsStore.ts'), 'utf-8');

test('newsStore.loadLiveData never sets liveNews:null unconditionally on unavailable path', () => {
  // Locate the unavailable branch (everything after the `client_gdelt`
  // return). It must not contain a literal `liveNews: null` assignment
  // — the fix preserves the previous liveNews when one exists.
  const tail = newsStoreSrc.split("kind === 'client_gdelt'")[1] || '';
  // Find the first `dataSource: 'unavailable'` set after that point.
  const unavailableIdx = tail.indexOf("dataSource: 'unavailable'");
  assert.ok(unavailableIdx > -1, 'unavailable path must exist');
  // Window of code around the unavailable set call — fail if it still
  // resets liveNews unconditionally.
  const window = tail.slice(Math.max(0, unavailableIdx - 200), unavailableIdx + 200);
  assert.doesNotMatch(
    window,
    /set\(\s*\{\s*liveNews:\s*null/,
    'unavailable path must NOT reset liveNews to null unconditionally — that blanks the map on transient failures',
  );
});

test('newsStore.loadLiveData preserves existing liveNews on unavailable path', () => {
  // The fix uses the functional form of set() and reads s.liveNews to
  // decide whether to write `liveNews: null`. Confirm both the
  // functional set form and the preservation read are present in the
  // unavailable branch.
  const tail = newsStoreSrc.split("kind === 'client_gdelt'")[1] || '';
  const unavailableIdx = tail.indexOf("dataSource: 'unavailable'");
  const window = tail.slice(Math.max(0, unavailableIdx - 400), unavailableIdx + 200);
  assert.match(window, /set\(\(s\)\s*=>/, 'unavailable path must use functional set() to read prior liveNews');
  assert.match(window, /s\.liveNews/, 'unavailable path must check prior liveNews to decide whether to null it');
});
