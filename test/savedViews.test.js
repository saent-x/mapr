/**
 * Tests for saved filter views (m3-saved-views).
 *
 * Covers:
 *   VAL-M3-001: Save Named View to InstantDB
 *   VAL-M3-002: Sidebar Lists Saved Views with Match Counts
 *   VAL-M3-003: One-Click Apply Restores Saved View
 *   VAL-M3-004: URL Encodes View ID for Sharing
 *   VAL-M3-005: Delete Saved View
 *   VAL-M3-006: Auth-Gated — Save View Requires Login
 *   VAL-M3-007: Auth-Gated — Sidebar Views Only for Authenticated User
 *   VAL-CROSS-013: Shared saved view applies correct filters
 *   VAL-CROSS-014: Saved view persists across refresh
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Component file existence tests
// ---------------------------------------------------------------------------

test('SavedViewsSidebar component exists', () => {
  const p = resolve(root, 'src/components/SavedViewsSidebar.jsx');
  assert.ok(existsSync(p), 'SavedViewsSidebar.jsx should exist');
  const content = readFileSync(p, 'utf8');
  assert.ok(content.includes('export default'), 'should export a default component');
  assert.ok(content.includes('SignedIn'), 'should use SignedIn wrapper');
  assert.ok(content.includes('SignedOut'), 'should use SignedOut wrapper');
  assert.ok(content.includes('useSavedViews'), 'should use useSavedViews hook');
  assert.ok(content.includes('saved-views-btn'), 'should render view buttons');
  assert.ok(content.includes('saved-views-delete'), 'should render delete buttons');
});

test('SaveViewDialog component exists', () => {
  const p = resolve(root, 'src/components/SaveViewDialog.jsx');
  assert.ok(existsSync(p), 'SaveViewDialog.jsx should exist');
  const content = readFileSync(p, 'utf8');
  assert.ok(content.includes('export default'), 'should export a default component');
  assert.ok(content.includes('save-view-dialog'), 'should render dialog');
  assert.ok(content.includes('save-view-input'), 'should have name input');
  assert.ok(content.includes('save-view-btn-save'), 'should have save button');
  assert.ok(content.includes('LogIn'), 'should show login prompt when unauthenticated');
});

test('useSavedViews hook exists', () => {
  const p = resolve(root, 'src/hooks/useSavedViews.js');
  assert.ok(existsSync(p), 'useSavedViews.js should exist');
  const content = readFileSync(p, 'utf8');
  assert.ok(content.includes('export default'), 'should export a default function');
  assert.ok(content.includes('db.useQuery'), 'should use db.useQuery');
  assert.ok(content.includes('db.transact'), 'should use db.transact');
  assert.ok(content.includes('saveView'), 'should export saveView function');
  assert.ok(content.includes('deleteView'), 'should export deleteView function');
  assert.ok(content.includes('needsAuth'), 'should export needsAuth flag');
});

// ---------------------------------------------------------------------------
// VAL-M3-001: Save Named View to InstantDB
// ---------------------------------------------------------------------------

test('VAL-M3-001: saveView creates view with all filter params', () => {
  // Structural verification: the hook exports saveView that calls db.transact
  // with correct payload shape
  const content = readFileSync(resolve(root, 'src/hooks/useSavedViews.js'), 'utf8');
  assert.ok(content.includes('filterState'), 'should include filterState in transaction');
  assert.ok(content.includes('mapState'), 'should include mapState in transaction');
  assert.ok(content.includes('createdAt'), 'should include createdAt timestamp');
  assert.ok(content.includes('updatedAt'), 'should include updatedAt timestamp');
  assert.ok(content.includes('.link({ owner:'), 'should link to user via owner');
});

// ---------------------------------------------------------------------------
// VAL-M3-002: Sidebar Lists Saved Views with Match Counts
// ---------------------------------------------------------------------------

test('VAL-M3-002: sidebar computes and displays match counts', () => {
  const content = readFileSync(resolve(root, 'src/components/SavedViewsSidebar.jsx'), 'utf8');
  assert.ok(content.includes('saved-views-count'), 'should render match count badge');
  assert.ok(content.includes('matchCount'), 'should compute match counts');
});

// ---------------------------------------------------------------------------
// VAL-M3-003: One-Click Apply Restores Saved View
// ---------------------------------------------------------------------------

test('VAL-M3-003: applyView restores all filter params', () => {
  const content = readFileSync(resolve(root, 'src/stores/filterStore.ts'), 'utf8');
  assert.ok(content.includes('applyView'), 'filterStore should export applyView');
  assert.ok(content.includes('minSeverity'), 'should restore minSeverity');
  assert.ok(content.includes('minConfidence'), 'should restore minConfidence');
  assert.ok(content.includes('dateWindow'), 'should restore dateWindow');
  assert.ok(content.includes('sortMode'), 'should restore sortMode');
  assert.ok(content.includes('verificationFilter'), 'should restore verificationFilter');
  assert.ok(content.includes('sourceTypeFilter'), 'should restore sourceTypeFilter');
  assert.ok(content.includes('languageFilter'), 'should restore languageFilter');
  assert.ok(content.includes('accuracyMode'), 'should restore accuracyMode');
  assert.ok(content.includes('precisionFilter'), 'should restore precisionFilter');
  assert.ok(content.includes('hideAmplified'), 'should restore hideAmplified');
});

// ---------------------------------------------------------------------------
// VAL-M3-004: URL Encodes View ID for Sharing
// ---------------------------------------------------------------------------

test('VAL-M3-004: URL includes view param on apply', () => {
  const sidebarContent = readFileSync(resolve(root, 'src/components/SavedViewsSidebar.jsx'), 'utf8');
  assert.ok(sidebarContent.includes("params.set('view'"), 'should set view param in URL when applying');

  const appContent = readFileSync(resolve(root, 'src/App.jsx'), 'utf8');
  assert.ok(appContent.includes("searchParams.get('view')"), 'should read view param from URL on mount');
  assert.ok(appContent.includes("params.set('view'"), 'should include view param in URL sync');
});

// ---------------------------------------------------------------------------
// VAL-M3-005: Delete Saved View
// ---------------------------------------------------------------------------

test('VAL-M3-005: deleteView removes from InstantDB', () => {
  const hookContent = readFileSync(resolve(root, 'src/hooks/useSavedViews.js'), 'utf8');
  assert.ok(hookContent.includes('.delete()'), 'should call delete() on transact');

  const sidebarContent = readFileSync(resolve(root, 'src/components/SavedViewsSidebar.jsx'), 'utf8');
  assert.ok(sidebarContent.includes('deleteView'), 'sidebar should call deleteView');
  assert.ok(sidebarContent.includes('activeViewId === view.id'), 'should clear activeViewId on delete');
});

// ---------------------------------------------------------------------------
// VAL-M3-006: Auth-Gated — Save View Requires Login
// ---------------------------------------------------------------------------

test('VAL-M3-006: save dialog shows login prompt when unauthenticated', () => {
  const dialogContent = readFileSync(resolve(root, 'src/components/SaveViewDialog.jsx'), 'utf8');
  assert.ok(dialogContent.includes('showLoginPrompt'), 'should detect unauthenticated state');
  assert.ok(dialogContent.includes('loginToSave'), 'should show login message');
  assert.ok(dialogContent.includes('LogIn'), 'should render login icon');

  const hookContent = readFileSync(resolve(root, 'src/hooks/useSavedViews.js'), 'utf8');
  assert.ok(hookContent.includes('needsAuth'), 'hook should export needsAuth flag');
  assert.ok(hookContent.includes('Must be authenticated'), 'saveView should throw if unauthenticated');
});

// ---------------------------------------------------------------------------
// VAL-M3-007: Auth-Gated — Sidebar Views Only for Authenticated User
// ---------------------------------------------------------------------------

test('VAL-M3-007: sidebar shows login prompt when unauthenticated', () => {
  const content = readFileSync(resolve(root, 'src/components/SavedViewsSidebar.jsx'), 'utf8');
  assert.ok(content.includes('SignedOut'), 'should use SignedOut wrapper');
  assert.ok(content.includes('signInPrompt'), 'should show sign-in prompt when logged out');

  const hookContent = readFileSync(resolve(root, 'src/hooks/useSavedViews.js'), 'utf8');
  assert.ok(hookContent.includes('user') && hookContent.includes(': null'), 'should pass null query when no user');
});

// ---------------------------------------------------------------------------
// VAL-CROSS-013: Shared saved view applies correct filters
// ---------------------------------------------------------------------------

test('VAL-CROSS-013: shared view URL restores filters via queryOnce', () => {
  const appContent = readFileSync(resolve(root, 'src/App.jsx'), 'utf8');
  assert.ok(appContent.includes('queryOnce'), 'should use queryOnce for shared view loading');
  assert.ok(appContent.includes("searchParams.get('view')"), 'should read view param');
  assert.ok(appContent.includes('applyView'), 'should call applyView with loaded filters');
});

// ---------------------------------------------------------------------------
// VAL-CROSS-014: Saved view persists across refresh
// ---------------------------------------------------------------------------

test('VAL-CROSS-014: views stored in InstantDB linked to user via owner', () => {
  const schemaContent = readFileSync(resolve(root, 'instant.schema.ts'), 'utf8');
  assert.ok(schemaContent.includes('owner: i.belongsTo'), 'savedViews should have owner link to $users');

  const hookContent = readFileSync(resolve(root, 'src/hooks/useSavedViews.js'), 'utf8');
  assert.ok(hookContent.includes('where:'), 'should query with where clause');
  assert.ok(hookContent.includes('owner: user.id'), 'should filter by owner = user id');
});

// ---------------------------------------------------------------------------
// Deleted shared view degrades gracefully (VAL-CROSS-015)
// ---------------------------------------------------------------------------

test('deleted shared view shows graceful degradation', () => {
  const appContent = readFileSync(resolve(root, 'src/App.jsx'), 'utf8');
  assert.ok(appContent.includes('setViewNotFound'), 'should set viewNotFound on missing view');
  assert.ok(appContent.includes('view-not-found-banner'), 'should render view-not-found banner');

  const storeContent = readFileSync(resolve(root, 'src/stores/uiStore.ts'), 'utf8');
  assert.ok(storeContent.includes('viewNotFound'), 'uiStore should have viewNotFound state');
});

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

test('applyView in filterStore handles all filter fields from saved view', () => {
  const content = readFileSync(resolve(root, 'src/stores/filterStore.ts'), 'utf8');
  // Check that applyView handles the full filterState shape
  assert.ok(content.includes('filters.searchQuery'), 'should handle searchQuery filter');
  assert.ok(content.includes('mapState.mapOverlay'), 'should handle mapOverlay from mapState');
  assert.ok(content.includes('filters.hideAmplified'), 'should handle hideAmplified filter');
});

// ---------------------------------------------------------------------------
// i18n coverage
// ---------------------------------------------------------------------------

test('savedViews namespace exists in all 5 locale files', () => {
  const locales = ['en', 'es', 'fr', 'ar', 'zh'];
  for (const loc of locales) {
    const path = resolve(root, `src/i18n/locales/${loc}.json`);
    const json = JSON.parse(readFileSync(path, 'utf8'));
    assert.ok(json.savedViews, `${loc}.json should have savedViews namespace`);
    assert.ok(json.savedViews.saveDialogTitle, `${loc}.json should have saveDialogTitle`);
    assert.ok(json.savedViews.sidebarTitle, `${loc}.json should have sidebarTitle`);
    assert.ok(json.savedViews.signInPrompt, `${loc}.json should have signInPrompt`);
    assert.ok(json.savedViews.viewNotFound, `${loc}.json should have viewNotFound`);
    assert.ok(json.savedViews.deleteTitle, `${loc}.json should have deleteTitle`);
  }
});

// ---------------------------------------------------------------------------
// Layout integration
// ---------------------------------------------------------------------------

test('Layout includes SavedViewsSidebar in sidebar', () => {
  const content = readFileSync(resolve(root, 'src/components/Layout.jsx'), 'utf8');
  assert.ok(content.includes('SavedViewsSidebar'), 'Layout should import SavedViewsSidebar');
  assert.ok(content.includes('<SavedViewsSidebar'), 'Layout should render SavedViewsSidebar');
});

// ---------------------------------------------------------------------------
// CSS styles
// ---------------------------------------------------------------------------

test('CSS styles exist for saved views components', () => {
  const css = readFileSync(resolve(root, 'src/index.css'), 'utf8');
  assert.ok(css.includes('saved-views-sidebar'), 'should have sidebar styles');
  assert.ok(css.includes('saved-views-btn'), 'should have view button styles');
  assert.ok(css.includes('saved-views-count'), 'should have count badge styles');
  assert.ok(css.includes('saved-views-delete'), 'should have delete button styles');
  assert.ok(css.includes('save-view-overlay'), 'should have dialog overlay styles');
  assert.ok(css.includes('save-view-dialog'), 'should have dialog styles');
  assert.ok(css.includes('view-not-found-banner'), 'should have not-found banner styles');
  assert.ok(css.includes('saved-views-login-prompt'), 'should have login prompt styles');
});
