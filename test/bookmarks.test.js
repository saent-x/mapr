/**
 * Tests for story bookmarking (m3-story-bookmarking).
 *
 * Covers:
 *   VAL-M3-020: Bookmark a Story
 *   VAL-M3-021: Bookmarks Panel Accessible and Lists Bookmarks
 *   VAL-M3-022: Filter Bookmarks by Region, Severity, Date
 *   VAL-M3-023: Auth-Gated — Bookmarking Requires Login
 *   VAL-M3-024: Remove Bookmark
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Component file existence
// ---------------------------------------------------------------------------

test('useBookmarks hook exists', () => {
  const p = resolve(root, 'src/hooks/useBookmarks.js');
  assert.ok(existsSync(p), 'useBookmarks.js should exist');
  const content = readFileSync(p, 'utf8');
  assert.ok(content.includes('export default'), 'should export a default function');
  assert.ok(content.includes('db.useQuery'), 'should use db.useQuery for InstantDB query');
  assert.ok(content.includes('db.transact'), 'should use db.transact for writes');
  assert.ok(content.includes('toggleBookmark'), 'should export toggleBookmark function');
  assert.ok(content.includes('isBookmarked'), 'should export isBookmarked function');
  assert.ok(content.includes('needsAuth'), 'should export needsAuth flag');
  assert.ok(content.includes('filteredBookmarks'), 'should export filteredBookmarks');
  assert.ok(content.includes('setFilterRegion'), 'should export setFilterRegion');
  assert.ok(content.includes('setFilterMinSeverity'), 'should export setFilterMinSeverity');
  assert.ok(content.includes('setFilterDateFrom'), 'should export setFilterDateFrom');
  assert.ok(content.includes('setFilterDateTo'), 'should export setFilterDateTo');
});

test('BookmarkButton component exists', () => {
  const p = resolve(root, 'src/components/BookmarkButton.jsx');
  assert.ok(existsSync(p), 'BookmarkButton.jsx should exist');
  const content = readFileSync(p, 'utf8');
  assert.ok(content.includes('export default'), 'should export a default component');
  assert.ok(content.includes('SignedIn'), 'should use SignedIn wrapper');
  assert.ok(content.includes('SignedOut'), 'should use SignedOut wrapper');
  assert.ok(content.includes('Bookmark'), 'should use Bookmark icon from lucide-react');
  assert.ok(content.includes('isBookmarked'), 'should check bookmark state');
  assert.ok(content.includes('toggleBookmark'), 'should call toggleBookmark');
  assert.ok(content.includes('is-bookmarked'), 'should apply bookmarked class');
  assert.ok(content.includes('data-bookmarked'), 'should have data-bookmarked attribute');
});

test('BookmarksPanel component exists', () => {
  const p = resolve(root, 'src/components/BookmarksPanel.jsx');
  assert.ok(existsSync(p), 'BookmarksPanel.jsx should exist');
  const content = readFileSync(p, 'utf8');
  assert.ok(content.includes('export default'), 'should export a default component');
  assert.ok(content.includes('useNavigate'), 'should use useNavigate for login redirect');
  assert.ok(content.includes('needsAuth'), 'should check needsAuth for signed-out state');
  assert.ok(content.includes('useBookmarks'), 'should use useBookmarks hook');
  assert.ok(content.includes('bookmarks-sidebar'), 'should render bookmarks sidebar');
  assert.ok(content.includes('bookmarks-list'), 'should render bookmarks list');
  assert.ok(content.includes('bookmarks-filters'), 'should render filter controls');
  assert.ok(content.includes('filterRegion'), 'should have region filter');
  assert.ok(content.includes('filterMinSeverity'), 'should have severity filter');
  assert.ok(content.includes('filterDateFrom'), 'should have date from filter');
  assert.ok(content.includes('filterDateTo'), 'should have date to filter');
  assert.ok(content.includes('bookmarks-item'), 'should render bookmark items');
});

// ---------------------------------------------------------------------------
// VAL-M3-020: Bookmark a Story
// ---------------------------------------------------------------------------

test('VAL-M3-020: toggleBookmark adds bookmark with correct fields', () => {
  const content = readFileSync(resolve(root, 'src/hooks/useBookmarks.js'), 'utf8');

  // toggleBookmark transaction must include all required fields
  assert.ok(content.includes('storyId'), 'should include storyId in transaction');
  assert.ok(content.includes('storyTitle'), 'should include storyTitle');
  assert.ok(content.includes('region'), 'should include region');
  assert.ok(content.includes('severity'), 'should include severity');
  assert.ok(content.includes('bookmarkedAt'), 'should include bookmarkedAt timestamp');
  assert.ok(content.includes('.link({ owner:'), 'should link to user via owner');

  // Hook must enforce auth
  assert.ok(content.includes('Must be authenticated'), 'should throw if not authenticated');
});

test('VAL-M3-020: bookmark linked to user in InstantDB', () => {
  // Schema verification — InstantDB requires relationships in the dedicated
  // `links:` block (not as `belongsTo` shorthand inside the entity).
  const schema = readFileSync(resolve(root, 'instant.schema.ts'), 'utf8');
  assert.ok(schema.includes('bookmarks: i.entity'), 'bookmarks entity should be defined');
  assert.ok(schema.includes('storyId: i.string()'), 'should have storyId string field');
  assert.ok(schema.includes('storyTitle: i.string()'), 'should have storyTitle string field');
  assert.ok(schema.includes('region: i.string()'), 'should have region string field');
  assert.ok(schema.includes('severity: i.number()'), 'should have severity number field');
  assert.ok(schema.includes('bookmarkedAt: i.number()'), 'should have bookmarkedAt number field');
  assert.ok(schema.includes('userBookmarks:'), 'should declare userBookmarks link');
  assert.match(schema, /userBookmarks:\s*\{[\s\S]*forward:\s*\{\s*on:\s*'bookmarks',\s*has:\s*'one',\s*label:\s*'owner'/,
    'userBookmarks forward link must be bookmarks.owner → $users (one)');
});

test('VAL-M3-020: $users has bookmarks reverse link', () => {
  const schema = readFileSync(resolve(root, 'instant.schema.ts'), 'utf8');
  assert.match(schema, /userBookmarks:\s*\{[\s\S]*reverse:\s*\{\s*on:\s*'\$users',\s*has:\s*'many',\s*label:\s*'bookmarks'/,
    '$users should have a many bookmarks reverse link');
});

// ---------------------------------------------------------------------------
// VAL-M3-021: Bookmarks Panel Accessible and Lists Bookmarks
// ---------------------------------------------------------------------------

test('VAL-M3-021: bookmarks panel lists all bookmarks', () => {
  const content = readFileSync(resolve(root, 'src/components/BookmarksPanel.jsx'), 'utf8');

  // Panel renders bookmark list
  assert.ok(content.includes('bookmarks-list'), 'should render bookmarks list');
  assert.ok(content.includes('bookmarked'), 'should compute bookmarked state');
  assert.ok(content.includes('bookmarks-item'), 'should render individual bookmark items');

  // Each item shows story info
  assert.ok(content.includes('storyTitle'), 'should show story title');
  assert.ok(content.includes('region'), 'should show region');
  assert.ok(content.includes('severity'), 'should show severity');

  // Should handle empty state
  assert.ok(content.includes('emptyHint'), 'should show empty hint when no bookmarks');
  assert.ok(content.includes('noFilteredBookmarks'), 'should show message when filters produce empty result');
});

test('VAL-M3-021: bookmark panel accessible from sidebar', () => {
  const layoutContent = readFileSync(resolve(root, 'src/components/Layout.jsx'), 'utf8');
  assert.ok(layoutContent.includes('BookmarksPanel'), 'Layout should import BookmarksPanel');
  assert.ok(layoutContent.includes('<BookmarksPanel'), 'Layout should render BookmarksPanel');
});

test('VAL-M3-021: bookmark button on news items', () => {
  const newsContent = readFileSync(resolve(root, 'src/components/NewsPanel.jsx'), 'utf8');
  assert.ok(newsContent.includes('BookmarkButton'), 'NewsPanel should import BookmarkButton');
  assert.ok(newsContent.includes('<BookmarkButton'), 'NewsPanel should render BookmarkButton in each item');
});

// ---------------------------------------------------------------------------
// VAL-M3-022: Filter Bookmarks by Region, Severity, Date
// ---------------------------------------------------------------------------

test('VAL-M3-022: filter by region reduces bookmark list', () => {
  const content = readFileSync(resolve(root, 'src/hooks/useBookmarks.js'), 'utf8');

  // Region filter
  assert.ok(content.includes('filterRegion'), 'should have region filter state');
  assert.ok(content.includes("result = result.filter((b) => b.region === regionUpper)"), 'should filter by exact region match');

  // Filter controls in panel
  const panelContent = readFileSync(resolve(root, 'src/components/BookmarksPanel.jsx'), 'utf8');
  assert.ok(panelContent.includes('filterRegion'), 'panel should use region filter');
  assert.ok(panelContent.includes('bm-filter-region'), 'should have region select element');
  assert.ok(panelContent.includes('uniqueRegions'), 'should compute unique regions from bookmarks');
});

test('VAL-M3-022: filter by severity threshold', () => {
  const content = readFileSync(resolve(root, 'src/hooks/useBookmarks.js'), 'utf8');

  // Severity filter
  assert.ok(content.includes('filterMinSeverity'), 'should have severity filter state');
  assert.ok(content.includes("result = result.filter((b) => b.severity >= filterMinSeverity)"), 'should filter by severity >= threshold');

  // Severity options in panel
  const panelContent = readFileSync(resolve(root, 'src/components/BookmarksPanel.jsx'), 'utf8');
  assert.ok(panelContent.includes('SEVERITY_OPTIONS'), 'should have severity options');
  assert.ok(panelContent.includes('bm-filter-sev'), 'should have severity select element');
  assert.ok(panelContent.includes('setFilterMinSeverity'), 'should call setFilterMinSeverity on change');
});

test('VAL-M3-022: filter by date range', () => {
  const content = readFileSync(resolve(root, 'src/hooks/useBookmarks.js'), 'utf8');

  // Date from filter
  assert.ok(content.includes('filterDateFrom'), 'should have date from filter state');
  assert.ok(content.includes("b.bookmarkedAt >= fromTs"), 'should filter by bookmarkedAt >= from date');

  // Date to filter
  assert.ok(content.includes('filterDateTo'), 'should have date to filter state');
  assert.ok(content.includes('endOfDay'), 'should compute end-of-day for to date');

  // Date inputs in panel
  const panelContent = readFileSync(resolve(root, 'src/components/BookmarksPanel.jsx'), 'utf8');
  assert.ok(panelContent.includes('type="date"'), 'should use date inputs');
  assert.ok(panelContent.includes('filterDateFrom'), 'should use date from filter');
  assert.ok(panelContent.includes('filterDateTo'), 'should use date to filter');
});

test('VAL-M3-022: filter clear button resets all filters', () => {
  const panelContent = readFileSync(resolve(root, 'src/components/BookmarksPanel.jsx'), 'utf8');

  assert.ok(panelContent.includes('filterClear'), 'should have clear filters button');
  assert.ok(panelContent.includes("setFilterRegion('')"), 'should clear region filter');
  assert.ok(panelContent.includes('setFilterMinSeverity(0)'), 'should reset severity filter');
  assert.ok(panelContent.includes("setFilterDateFrom('')"), 'should clear date from');
  assert.ok(panelContent.includes("setFilterDateTo('')"), 'should clear date to');
});

test('VAL-M3-022: filter show/hide toggle', () => {
  const panelContent = readFileSync(resolve(root, 'src/components/BookmarksPanel.jsx'), 'utf8');
  assert.ok(panelContent.includes('showFilters'), 'should have showFilters state');
  assert.ok(panelContent.includes('setShowFilters'), 'should have setShowFilters');
  assert.ok(panelContent.includes('Filters'), 'should render filter icon button');
});

// ---------------------------------------------------------------------------
// VAL-M3-023: Auth-Gated — Bookmarking Requires Login
// ---------------------------------------------------------------------------

test('VAL-M3-023: bookmark button navigates to login when unauthenticated', () => {
  const content = readFileSync(resolve(root, 'src/components/BookmarkButton.jsx'), 'utf8');

  assert.ok(content.includes('SignedOut'), 'should use SignedOut wrapper');
  assert.ok(content.includes("title={t('bookmarks.signInToBookmark')}"), 'should show login prompt title');
  assert.ok(content.includes('useNavigate'), 'should import useNavigate');
  assert.ok(content.includes('useLocation'), 'should import useLocation from react-router-dom');
  assert.ok(content.includes("navigate(`/login?returnUrl="), 'should navigate to /login with returnUrl');
  assert.ok(content.includes('encodeURIComponent(location.pathname + location.search)'), 'should encode current URL as returnUrl');
  assert.ok(content.includes('e.stopPropagation()'), 'should stop propagation in SignedOut handler');
  assert.ok(content.includes('e.preventDefault()'), 'should prevent default in SignedOut handler');
});

test('VAL-M3-023: bookmark panel shows login prompt when unauthenticated', () => {
  const content = readFileSync(resolve(root, 'src/components/BookmarksPanel.jsx'), 'utf8');

  assert.ok(content.includes('needsAuth'), 'should check needsAuth');
  assert.ok(content.includes('signInPrompt'), 'should show sign-in prompt when logged out');
  assert.ok(content.includes('useNavigate'), 'should redirect to /login when clicked');
  assert.ok(content.includes('needsAuth'), 'should check needsAuth');
  assert.ok(content.includes('sidebar-pro-feature-action'), 'signed-out panel should render an icon action');
  assert.ok(content.includes('sidebar-pro-badge'), 'signed-out panel should mark bookmarks as Pro');
});

test('VAL-M3-023: hook skips query when unauthenticated', () => {
  const content = readFileSync(resolve(root, 'src/hooks/useBookmarks.js'), 'utf8');

  assert.ok(content.includes('user'), 'should check for user');
  assert.ok(content.includes(': null'), 'should pass null query when no user');
});

test('VAL-M3-023: toggleBookmark throws if unauthenticated', () => {
  const content = readFileSync(resolve(root, 'src/hooks/useBookmarks.js'), 'utf8');
  assert.ok(content.includes("Must be authenticated to bookmark"), 'should throw auth error');
});

// ---------------------------------------------------------------------------
// VAL-M3-024: Remove Bookmark
// ---------------------------------------------------------------------------

test('VAL-M3-024: toggleBookmark removes existing bookmark', () => {
  const content = readFileSync(resolve(root, 'src/hooks/useBookmarks.js'), 'utf8');

  // When bookmarked, toggle should delete
  assert.ok(content.includes('existing = bookmarks.find'), 'should find existing bookmark');
  assert.ok(content.includes('db.tx.bookmarks[existing.id].delete()'), 'should call delete on existing bookmark');

  // When not bookmarked, toggle should create
  assert.ok(content.includes('const bmId = id()'), 'should generate a UUID bookmark ID');
  assert.ok(content.includes('db.tx.bookmarks[bmId]'), 'should create new bookmark');
});

test('VAL-M3-024: remove button in bookmarks panel', () => {
  const content = readFileSync(resolve(root, 'src/components/BookmarksPanel.jsx'), 'utf8');

  assert.ok(content.includes('handleRemove'), 'should have remove handler');
  assert.ok(content.includes('toggleBookmark'), 'should call toggleBookmark to remove');
  assert.ok(content.includes("bookmark-remove-btn"), 'should render compact bookmark remove button');
});

test('VAL-M3-024: bookmark button shows unbookmarked state after removal', () => {
  const buttonContent = readFileSync(resolve(root, 'src/components/BookmarkButton.jsx'), 'utf8');

  assert.ok(buttonContent.includes('isBookmarked'), 'should check isBookmarked state');
  assert.ok(buttonContent.includes("fill={bookmarked ? 'currentColor' : 'none'}"), 'should use filled icon when bookmarked');
  assert.ok(buttonContent.includes("is-bookmarked"), 'should apply is-bookmarked class when active');
});

// ---------------------------------------------------------------------------
// i18n coverage
// ---------------------------------------------------------------------------

test('bookmarks namespace exists in all 5 locale files', () => {
  const locales = ['en', 'es', 'fr', 'ar', 'zh'];
  const requiredKeys = [
    'sidebarTitle', 'emptyHint', 'noFilteredBookmarks', 'signInPrompt',
    'signInToBookmark', 'filterRegion', 'filterAll', 'filterSeverity',
    'filterDate', 'filterDateFrom', 'filterDateTo', 'filterClear', 'bookmarked',
  ];
  for (const loc of locales) {
    const path = resolve(root, `src/i18n/locales/${loc}.json`);
    const json = JSON.parse(readFileSync(path, 'utf8'));
    assert.ok(json.bookmarks, `${loc}.json should have bookmarks namespace`);
    for (const key of requiredKeys) {
      assert.ok(json.bookmarks[key] !== undefined,
        `${loc}.json bookmarks.${key} should exist`);
      assert.ok(typeof json.bookmarks[key] === 'string',
        `${loc}.json bookmarks.${key} should be a string`);
    }
  }
});

// ---------------------------------------------------------------------------
// CSS styles
// ---------------------------------------------------------------------------

test('CSS styles exist for bookmarks components', () => {
  const css = readFileSync(resolve(root, 'src/index.css'), 'utf8');
  assert.ok(css.includes('.bookmarks-sidebar'), 'should have bookmarks-sidebar styles');
  assert.ok(css.includes('.bookmarks-filters'), 'should have filters styles');
  assert.ok(css.includes('.bookmarks-filter-row'), 'should have filter row styles');
  assert.ok(css.includes('.bookmarks-filter-select'), 'should have filter select styles');
  assert.ok(css.includes('.bookmarks-filter-date-row'), 'should have filter date row styles');
  assert.ok(css.includes('.bookmarks-filter-date'), 'should have filter date input styles');
  assert.ok(css.includes('.bookmarks-filter-clear'), 'should have filter clear styles');
  assert.ok(css.includes('.bookmarks-list'), 'should have list styles');
  assert.ok(css.includes('.bookmarks-item'), 'should have item styles');
  assert.ok(css.includes('.bookmarks-item-title'), 'should have title styles');
  assert.ok(css.includes('.bookmarks-item-main'), 'should have dedicated bookmark row button styles');
  assert.ok(css.includes('.bookmarks-item-header'), 'should have compact bookmark header layout');
  assert.ok(css.includes('-webkit-line-clamp: 2'), 'bookmark titles should clamp instead of overflowing the sidebar flyout');
  assert.ok(css.includes('.bookmarks-item-meta'), 'should have meta styles');
  assert.ok(css.includes('.bookmarks-item-region'), 'should have region styles');
  assert.ok(css.includes('.bookmarks-item-ago'), 'should have ago styles');
  assert.ok(css.includes('.bookmark-btn'), 'should have bookmark button styles');
  assert.ok(css.includes('.bookmark-btn.is-bookmarked'), 'should have bookmarked state styles');
  assert.ok(css.includes('.news-bookmark-btn'), 'should have news bookmark positioning');
});

test('BookmarksPanel uses compact story-row anatomy', () => {
  const content = readFileSync(resolve(root, 'src/components/BookmarksPanel.jsx'), 'utf8');
  assert.ok(content.includes('className="bookmarks-item-main"'), 'bookmark rows should use a dedicated main story button');
  assert.ok(content.includes('className="bookmarks-item-header"'), 'bookmark rows should group title and severity in a header');
  assert.ok(content.includes('className="bookmarks-item-actions"'), 'bookmark row controls should be grouped in a compact action rail');
  assert.ok(content.includes('bookmark-remove-btn'), 'remove action should live with the bookmark actions');
  assert.ok(content.includes('rows={1}'), 'note input should start as a compact single-line control');
});

test('BookmarksPanel header shows filtered bookmark count badge', () => {
  const content = readFileSync(resolve(root, 'src/components/BookmarksPanel.jsx'), 'utf8');
  assert.ok(content.includes('sidebar-section-count-badge'), 'header should render a section count badge');
  assert.ok(content.includes('{filteredBookmarks.length}'), 'bookmarks header count should use visible filtered bookmarks');
  assert.ok(content.includes('{filteredBookmarks.length > 0 && ('), 'bookmarks header badge should be hidden when count is zero');
});

// ---------------------------------------------------------------------------
// Layout integration
// ---------------------------------------------------------------------------

test('Layout includes BookmarksPanel in sidebar', () => {
  const content = readFileSync(resolve(root, 'src/components/Layout.jsx'), 'utf8');
  assert.ok(content.includes('BookmarksPanel'), 'Layout should import BookmarksPanel');
  assert.ok(content.includes('<BookmarksPanel'), 'Layout should render BookmarksPanel');
});

// ---------------------------------------------------------------------------
// NewsPanel integration
// ---------------------------------------------------------------------------

test('NewsPanel renders BookmarkButton for each news item', () => {
  const content = readFileSync(resolve(root, 'src/components/NewsPanel.jsx'), 'utf8');
  assert.ok(content.includes('BookmarkButton'), 'NewsPanel should import BookmarkButton');
  assert.ok(content.includes('story={story}'), 'should pass story prop to BookmarkButton');
  assert.ok(content.includes('news-bookmark-btn'), 'should use news-bookmark-btn class');
});

// ---------------------------------------------------------------------------
// Bookmark data shape
// ---------------------------------------------------------------------------

test('bookmark filter logic handles edge cases', () => {
  const content = readFileSync(resolve(root, 'src/hooks/useBookmarks.js'), 'utf8');

  // Empty region filter should not filter
  assert.ok(content.includes("if (filterRegion)"), 'should only filter when filterRegion is set');

  // Zero severity should not filter
  assert.ok(content.includes("if (filterMinSeverity > 0)"), 'should only filter when threshold > 0');

  // Empty date should not filter
  assert.ok(content.includes("if (filterDateFrom)"), 'should only filter when dateFrom is set');
  assert.ok(content.includes("if (filterDateTo)"), 'should only filter when dateTo is set');

  // NaN handling
  assert.ok(content.includes('!Number.isNaN(fromTs)'), 'should check for NaN on date parsing');
  assert.ok(content.includes('!Number.isNaN(toTs)'), 'should check for NaN on date parsing');
});

// ---------------------------------------------------------------------------
// Bookmark toggle dedup
// ---------------------------------------------------------------------------

test('bookmark ID uses InstantDB UUIDs instead of story/user strings', () => {
  const content = readFileSync(resolve(root, 'src/hooks/useBookmarks.js'), 'utf8');
  assert.ok(content.includes("import { id } from '@instantdb/react'"), 'should import UUID helper');
  assert.ok(content.includes('const bmId = id()'), 'should use UUID IDs for InstantDB tx paths');
  assert.ok(!content.includes("bm-${story.id}-${user.id}"), 'should not use story/user strings as entity IDs');
});
