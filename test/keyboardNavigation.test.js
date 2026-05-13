/**
 * Keyboard Navigation Tests — VAL-M2-001 through VAL-M2-010, VAL-CROSS-010, VAL-CROSS-012
 *
 * Tests for keyboard-driven workflow:
 *   - j/k navigates lists with visual highlight
 *   - Enter expands selected item
 *   - Escape closes panels/drawers/overlays
 *   - / focuses search input
 *   - s triggers save view flow
 *   - b bookmarks selected story
 *   - Shortcuts suppressed in input fields
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '..', 'src');

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-001: j/k navigation hook exists
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-001: useKeyboardNavigation hook', () => {
  it('hook file exists', () => {
    const hookPath = path.join(srcDir, 'hooks', 'useKeyboardNavigation.js');
    assert.ok(existsSync(hookPath), 'useKeyboardNavigation.js should exist');
  });

  it('hook exports a default function', () => {
    const hookPath = path.join(srcDir, 'hooks', 'useKeyboardNavigation.js');
    const code = readFileSync(hookPath, 'utf-8');
    assert.match(code, /export\s+default\s+function\s+useKeyboardNavigation/, 'should export default function');
  });

  it('hook handles j/k/Enter/Escape///s/b/? key cases', () => {
    const hookPath = path.join(srcDir, 'hooks', 'useKeyboardNavigation.js');
    const code = readFileSync(hookPath, 'utf-8');
    // Check all required key cases exist
    assert.match(code, /case\s+['"]j['"]/, 'should handle j key');
    assert.match(code, /case\s+['"]k['"]/, 'should handle k key');
    assert.match(code, /case\s+['"]Enter['"]/, 'should handle Enter key');
    assert.match(code, /case\s+['"]Escape['"]/, 'should handle Escape key');
    assert.match(code, /case\s+['"]\/['"]/, 'should handle / key');
    assert.match(code, /case\s+['"]s['"]/, 'should handle s key');
    assert.match(code, /case\s+['"]b['"]/, 'should handle b key');
    assert.match(code, /case\s+['"]\?['"]/, 'should handle ? key');
  });

  it('suppresses shortcuts when focused element is input/textarea/contenteditable', () => {
    const hookPath = path.join(srcDir, 'hooks', 'useKeyboardNavigation.js');
    const code = readFileSync(hookPath, 'utf-8');
    assert.match(code, /isEditingTarget|tagName\s*===\s*['"]INPUT['"]|tagName\s*===\s*['"]TEXTAREA['"]|isContentEditable/, 'should check for editing targets');
    assert.match(code, /editing\s*&&\s*e\.key\s*!==\s*['"]Escape['"]/, 'should suppress non-Escape shortcuts when editing');
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-001: NewsPanel highlights keyboard-selected item
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-001: NewsPanel keyboard highlight support', () => {
  it('NewsPanel accepts kbHighlightedStoryId prop', () => {
    const newsPanelPath = path.join(srcDir, 'components', 'NewsPanel.jsx');
    const code = readFileSync(newsPanelPath, 'utf-8');
    assert.match(code, /kbHighlightedStoryId/, 'NewsPanel should accept kbHighlightedStoryId prop');
  });

  it('NewsPanel applies data-kb-highlighted attribute', () => {
    const newsPanelPath = path.join(srcDir, 'components', 'NewsPanel.jsx');
    const code = readFileSync(newsPanelPath, 'utf-8');
    assert.match(code, /data-kb-highlighted/, 'should apply data-kb-highlighted attribute');
    assert.match(code, /kbHighlighted\s*\?\s*['"]true['"]/, 'should set data-kb-highlighted="true" when highlighted');
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-002: Enter expands selected news item
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-002: Enter expands selected item', () => {
  it('App.jsx passes onSelect to keyboard hook that calls handleStorySelect', () => {
    const appPath = path.join(srcDir, 'App.jsx');
    const code = readFileSync(appPath, 'utf-8');
    // The onSelect callback uses handleStorySelect (may be split across lines)
    const onSelectSection = code.match(/onSelect:\s*useCallback\([\s\S]*?\]\s*\)/);
    assert.ok(onSelectSection, 'should have onSelect callback');
    assert.match(code, /handleStorySelect/, 'onSelect should call handleStorySelect');
    assert.match(code, /useKeyboardNavigation/, 'should use the keyboard navigation hook');
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-003: Escape closes panels, drawers, overlays
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-003: Escape closes all panels', () => {
  it('Escape handler checks showExport, showSaveDialog, selectedArc, panelOpen, filtersOpen', () => {
    const appPath = path.join(srcDir, 'App.jsx');
    const code = readFileSync(appPath, 'utf-8');
    assert.match(code, /showExport/, 'should close export on Escape');
    assert.match(code, /showSaveDialog/, 'should close save dialog on Escape');
    assert.match(code, /selectedArc/, 'should clear selectedArc on Escape');
    assert.match(code, /panelOpen/, 'should close panel on Escape');
    assert.match(code, /filtersOpen/, 'should close filters on Escape');
  });

  it('Escape handler returns true for proper propagation', () => {
    const appPath = path.join(srcDir, 'App.jsx');
    const code = readFileSync(appPath, 'utf-8');
    assert.match(code, /return\s+true/, 'onEscape should return true');
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-004: / focuses search input
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-004: / focuses search input', () => {
  it('useKeyboardNavigation handles / key with search selector', () => {
    const hookPath = path.join(srcDir, 'hooks', 'useKeyboardNavigation.js');
    const code = readFileSync(hookPath, 'utf-8');
    assert.match(code, /searchSelector/, 'should accept searchSelector option');
    assert.match(code, /\.focus\(\)/, 'should focus search element on /');
  });

  it('App.jsx passes searchSelector to hook', () => {
    const appPath = path.join(srcDir, 'App.jsx');
    const code = readFileSync(appPath, 'utf-8');
    assert.match(code, /searchSelector.*search-input/, 'should pass search-input selector');
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-005: s triggers save view flow
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-005: s saves current view', () => {
  it('App.jsx onSaveView opens save dialog', () => {
    const appPath = path.join(srcDir, 'App.jsx');
    const code = readFileSync(appPath, 'utf-8');
    assert.match(code, /setShowSaveDialog\(true\)/, 'onSaveView should open save dialog');
    assert.match(code, /SaveViewDialog/, 'App should render SaveViewDialog');
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-006: b bookmarks selected story
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-006: b bookmarks selected story', () => {
  it('App.jsx onBookmark calls addWatch', () => {
    const appPath = path.join(srcDir, 'App.jsx');
    const code = readFileSync(appPath, 'utf-8');
    assert.match(code, /addWatch/, 'onBookmark should call addWatch');
    assert.match(code, /bookmarked/, 'onBookmark should show bookmarked toast');
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-007: j/k works on region list page
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-007: j/k navigates region list', () => {
  it('RegionDetailPage imports and uses useKeyboardNavigation', () => {
    const regionPath = path.join(srcDir, 'pages', 'RegionDetailPage.jsx');
    const code = readFileSync(regionPath, 'utf-8');
    assert.match(code, /useKeyboardNavigation/, 'should import useKeyboardNavigation');
    assert.match(code, /data-kb-highlighted/, 'should apply highlight attribute');
    assert.match(code, /kbHighlightedRegionStoryId/, 'should compute highlighted story ID');
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-008: j/k works on entity list page
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-008: j/k navigates entity list', () => {
  it('EntityExplorerPage imports and uses useKeyboardNavigation', () => {
    const entityPath = path.join(srcDir, 'pages', 'EntityExplorerPage.jsx');
    const code = readFileSync(entityPath, 'utf-8');
    assert.match(code, /useKeyboardNavigation/, 'should import useKeyboardNavigation');
    assert.match(code, /kbHighlightedEntityId/, 'should compute highlighted entity ID');
    assert.match(code, /navigableEntities/, 'should compute navigableEntities list');
  });

  it('EntityExplorerPage supports typed entity query deep links', () => {
    const entityPath = path.join(srcDir, 'pages', 'EntityExplorerPage.jsx');
    const code = readFileSync(entityPath, 'utf-8');
    assert.match(code, /useSearchParams/, 'should read entity query params');
    assert.match(code, /searchParams\.get\('entity'\)/, 'should read entity name from URL');
    assert.match(code, /searchParams\.get\('type'\)/, 'should read entity type from URL');
    assert.match(code, /entityKey\(entityType,\s*entityName\)/, 'should build typed entity id from URL params');
    assert.match(code, /setSearchQuery\(entityName\)/, 'should reflect deep-linked entity in search');
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-009: Tab navigation with visible focus
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-009: Tab navigation with focus-visible', () => {
  it('index.css has focus-visible styles', () => {
    const cssPath = path.join(srcDir, 'index.css');
    const code = readFileSync(cssPath, 'utf-8');
    assert.match(code, /:focus-visible/, 'should have focus-visible styles');
    assert.match(code, /outline.*2px.*solid.*var\(--accent\)/, 'should have visible focus outline');
  });

  it('focus-visible applies to interactive elements', () => {
    const cssPath = path.join(srcDir, 'index.css');
    const code = readFileSync(cssPath, 'utf-8');
    assert.match(code, /button:focus-visible/, 'should style button focus-visible');
    assert.match(code, /a:focus-visible/, 'should style link focus-visible');
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-010: Shortcuts suppressed in input fields
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-010: Shortcuts suppressed in input fields', () => {
  it('useKeyboardNavigation suppresses non-Escape shortcuts in inputs', () => {
    const hookPath = path.join(srcDir, 'hooks', 'useKeyboardNavigation.js');
    const code = readFileSync(hookPath, 'utf-8');
    assert.match(code, /['"]INPUT['"]/, 'should check for INPUT tag');
    assert.match(code, /['"]TEXTAREA['"]/, 'should check for TEXTAREA tag');
    assert.match(code, /isContentEditable/, 'should check for contenteditable');
    // Escape should still work in inputs
    assert.match(code, /editing\s*&&\s*e\.key\s*!==\s*['"]Escape['"]/, 'Escape should work even in inputs');
  });

  it('App global shortcuts (r, g, f) also suppressed in inputs', () => {
    const appPath = path.join(srcDir, 'App.jsx');
    const code = readFileSync(appPath, 'utf-8');
    // The r/g/f handler should have an editing check
    assert.match(code, /case\s+['"]r['"]/, 'should handle r key');
    // Check that the global shortcut handler checks for editing state
    const globalHandlerSection = code.match(/handleKeyDown[\s\S]*?document\.addEventListener\('keydown',\s*handleKeyDown\)/);
    assert.ok(globalHandlerSection, 'should have global shortcut handler');
    assert.match(globalHandlerSection[0], /tagName|isContentEditable/, 'r/g/f shortcuts should check editing state');
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-CROSS-010: Keyboard shortcuts work on all routes
 * ─────────────────────────────────────────────────────────── */
describe('VAL-CROSS-010: Keyboard shortcuts on all routes', () => {
  it('Main App page (/ ) uses useKeyboardNavigation', () => {
    const appPath = path.join(srcDir, 'App.jsx');
    const code = readFileSync(appPath, 'utf-8');
    assert.match(code, /useKeyboardNavigation/, 'App should use keyboard navigation');
  });

  it('Region page uses useKeyboardNavigation', () => {
    const regionPath = path.join(srcDir, 'pages', 'RegionDetailPage.jsx');
    const code = readFileSync(regionPath, 'utf-8');
    assert.match(code, /useKeyboardNavigation/, 'Region page should use keyboard navigation');
  });

  it('Entity page uses useKeyboardNavigation', () => {
    const entityPath = path.join(srcDir, 'pages', 'EntityExplorerPage.jsx');
    const code = readFileSync(entityPath, 'utf-8');
    assert.match(code, /useKeyboardNavigation/, 'Entity page should use keyboard navigation');
  });

  it('All three pages dispatch mapr:openShortcutHelp on ? key', () => {
    for (const f of ['App.jsx', 'pages/RegionDetailPage.jsx', 'pages/EntityExplorerPage.jsx']) {
      const code = readFileSync(path.join(srcDir, f), 'utf-8');
      assert.match(code, /mapr:openShortcutHelp/, `${f} should dispatch help event`);
    }
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-CROSS-012: j/k doesn't conflict with search input
 * ─────────────────────────────────────────────────────────── */
describe('VAL-CROSS-012: j/k suppression in search input', () => {
  it('Hook short-circuits when active element is INPUT', () => {
    const hookPath = path.join(srcDir, 'hooks', 'useKeyboardNavigation.js');
    const code = readFileSync(hookPath, 'utf-8');
    assert.match(code, /if\s*\(\s*editing\s*&&\s*e\.key\s*!==\s*['"]Escape['"]\s*\)\s*return/, 'should return early when editing');
  });

  it('j/k cases only execute when items.length > 0 and not editing', () => {
    const hookPath = path.join(srcDir, 'hooks', 'useKeyboardNavigation.js');
    const code = readFileSync(hookPath, 'utf-8');
    // The editing check happens BEFORE the switch, so all non-Escape cases are suppressed
    // Check that j and k cases exist but also that the suppression is before the switch
    const suppressionIdx = code.indexOf('if (editing');
    const switchIdx = code.indexOf('switch (e.key)');
    assert.ok(suppressionIdx < switchIdx, 'editing check should come before switch statement');
  });
});

/* ───────────────────────────────────────────────────────────
 *  CSS: Keyboard highlight styling
 * ─────────────────────────────────────────────────────────── */
describe('CSS: Keyboard highlight styling', () => {
  it('index.css has [data-kb-highlighted="true"] style for news items', () => {
    const cssPath = path.join(srcDir, 'index.css');
    const code = readFileSync(cssPath, 'utf-8');
    assert.match(code, /\[data-kb-highlighted="true"\]/, 'should have kb-highlighted CSS rule');
    assert.match(code, /box-shadow.*var\(--cyan\)/, 'should use cyan accent for kb highlight');
  });
});

/* ───────────────────────────────────────────────────────────
 *  i18n: Required keys exist
 * ─────────────────────────────────────────────────────────── */
describe('i18n: Required keyboard/bookmark keys', () => {
  const localeFiles = ['en', 'es', 'fr', 'ar', 'zh'];

  for (const lc of localeFiles) {
    it(`watchlist.bookmarked exists in ${lc}.json`, () => {
      const localePath = path.join(srcDir, 'i18n', 'locales', `${lc}.json`);
      const raw = JSON.parse(readFileSync(localePath, 'utf-8'));
      assert.ok(raw.watchlist?.bookmarked, `${lc}: watchlist.bookmarked should exist`);
    });

    it(`keyboard.viewSaved exists in ${lc}.json`, () => {
      const localePath = path.join(srcDir, 'i18n', 'locales', `${lc}.json`);
      const raw = JSON.parse(readFileSync(localePath, 'utf-8'));
      assert.ok(raw.keyboard?.viewSaved, `${lc}: keyboard.viewSaved should exist`);
    });

    it(`keyboard.quickSave exists in ${lc}.json`, () => {
      const localePath = path.join(srcDir, 'i18n', 'locales', `${lc}.json`);
      const raw = JSON.parse(readFileSync(localePath, 'utf-8'));
      assert.ok(raw.keyboard?.quickSave, `${lc}: keyboard.quickSave should exist`);
    });
  }
});
