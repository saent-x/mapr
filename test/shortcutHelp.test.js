/**
 * Shortcut Help Overlay Tests — VAL-M2-016 through VAL-M2-019
 *
 * Tests for keyboard shortcut help overlay:
 *   - ? key dispatches mapr:openShortcutHelp event
 *   - ShortcutHelp component exists and listens for the event
 *   - Component uses MAPR tactical monospace aesthetic
 *   - Event handler suppresses ? in input fields
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '..', 'src');

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-016: ShortcutHelp component exists and opens on ? key
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-016: ShortcutHelp component exists', () => {
  it('ShortcutHelp.jsx file exists', () => {
    const compPath = path.join(srcDir, 'components', 'ShortcutHelp.jsx');
    assert.ok(existsSync(compPath), 'ShortcutHelp.jsx should exist');
  });

  it('ShortcutHelp component listens for mapr:openShortcutHelp event', () => {
    const compPath = path.join(srcDir, 'components', 'ShortcutHelp.jsx');
    const code = readFileSync(compPath, 'utf-8');
    assert.match(code, /mapr:openShortcutHelp/, 'should listen for mapr:openShortcutHelp event');
    assert.match(code, /addEventListener/, 'should add event listener');
  });

  it('ShortcutHelp component renders a dialog with role="dialog"', () => {
    const compPath = path.join(srcDir, 'components', 'ShortcutHelp.jsx');
    const code = readFileSync(compPath, 'utf-8');
    assert.match(code, /role="dialog"/, 'should render as dialog');
    assert.match(code, /aria-modal="true"/, 'should be aria-modal');
  });

  it('ShortcutHelp is wired into Layout.jsx', () => {
    const layoutPath = path.join(srcDir, 'components', 'Layout.jsx');
    const code = readFileSync(layoutPath, 'utf-8');
    assert.match(code, /import ShortcutHelp/, 'should import ShortcutHelp');
    assert.match(code, /<ShortcutHelp/, 'should render ShortcutHelp');
  });

  it('Keyboard hook dispatches mapr:openShortcutHelp on ? key', () => {
    const hookPath = path.join(srcDir, 'hooks', 'useKeyboardNavigation.js');
    const code = readFileSync(hookPath, 'utf-8');
    // The hook calls cb.onHelp() which dispatches the event
    assert.match(code, /case\s+['"]\?['"]/, 'should handle ? key');
    assert.match(code, /onHelp/, 'should call onHelp callback');
  });

  it('All three main pages wire onHelp to dispatch mapr:openShortcutHelp', () => {
    for (const f of ['App.jsx', 'pages/RegionDetailPage.jsx', 'pages/EntityExplorerPage.jsx']) {
      const code = readFileSync(path.join(srcDir, f), 'utf-8');
      assert.match(code, /mapr:openShortcutHelp/, `${f} should dispatch help event`);
    }
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-017: Shortcut help styled in MAPR tactical aesthetic
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-017: MAPR tactical monospace aesthetic', () => {
  it('ShortcutHelp component uses monospace font CSS class', () => {
    const compPath = path.join(srcDir, 'components', 'ShortcutHelp.jsx');
    const code = readFileSync(compPath, 'utf-8');
    assert.match(code, /shortcut-help/, 'should use shortcut-help CSS classes');
  });

  it('CSS uses MAPR tactical design tokens', () => {
    const cssPath = path.join(srcDir, 'index.css');
    const css = readFileSync(cssPath, 'utf-8');
    // Check that the shortcut help CSS exists
    assert.match(css, /\.shortcut-help-backdrop/, 'CSS should have backdrop styles');
    assert.match(css, /\.shortcut-help-panel/, 'CSS should have panel styles');
    assert.match(css, /\.shortcut-help-kbd/, 'CSS should have kbd styles');
    // MAPR design tokens
    assert.match(css, /var\(--ff-mono\)/, 'should use monospace font token');
    assert.match(css, /\.shortcut-help-panel.*\n.*font-family:\s*var\(--ff-mono\)/s, 'panel should use monospace');
  });

  it('CSS kbd badges styled as inline-code elements', () => {
    const cssPath = path.join(srcDir, 'index.css');
    const css = readFileSync(cssPath, 'utf-8');
    const kbdSection = css.match(/\.shortcut-help-kbd\s*\{[^}]*\}/s);
    assert.ok(kbdSection, 'kbd styles should exist');
    assert.match(kbdSection[0], /background:\s*var\(--bg-3\)/, 'kbd should have dark background');
    assert.match(kbdSection[0], /border.*var\(--line\)/, 'kbd should have border');
    assert.match(kbdSection[0], /font-family:\s*var\(--ff-mono\)/, 'kbd should use monospace font');
  });

  it('CSS section titles use amber/cyan accents', () => {
    const cssPath = path.join(srcDir, 'index.css');
    const css = readFileSync(cssPath, 'utf-8');
    // Title should be amber
    const titleSection = css.match(/\.shortcut-help-title\s*\{[^}]*\}/s);
    assert.ok(titleSection, 'title styles should exist');
    assert.match(titleSection[0], /var\(--amber\)/, 'title should use amber color');
    // Section titles should be cyan
    const sectionTitle = css.match(/\.shortcut-help-section-title\s*\{[^}]*\}/s);
    assert.ok(sectionTitle, 'section title styles should exist');
    assert.match(sectionTitle[0], /var\(--cyan\)/, 'section titles should use cyan color');
  });

  it('CSS kbd badges use amber color', () => {
    const cssPath = path.join(srcDir, 'index.css');
    const css = readFileSync(cssPath, 'utf-8');
    const kbdSection = css.match(/\.shortcut-help-kbd\s*\{[^}]*\}/s);
    assert.match(kbdSection[0], /color:\s*var\(--amber\)/, 'kbd should use amber text color');
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-018: Shortcut help closes on Escape and backdrop click
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-018: Close on Escape and backdrop click', () => {
  it('ShortcutHelp has Escape key handler that calls setOpen(false)', () => {
    const compPath = path.join(srcDir, 'components', 'ShortcutHelp.jsx');
    const code = readFileSync(compPath, 'utf-8');
    assert.match(code, /Escape/, 'should handle Escape key');
    assert.match(code, /setOpen\(false\)/, 'should close on Escape');
  });

  it('ShortcutHelp has backdrop click handler', () => {
    const compPath = path.join(srcDir, 'components', 'ShortcutHelp.jsx');
    const code = readFileSync(compPath, 'utf-8');
    assert.match(code, /handleBackdropClick/, 'should have backdrop click handler');
    // Backdrop click handler checks e.target === e.currentTarget
    assert.match(code, /e\.target\s*===\s*e\.currentTarget/, 'should check if click was on backdrop');
  });

  it('ShortcutHelp has close button with X icon', () => {
    const compPath = path.join(srcDir, 'components', 'ShortcutHelp.jsx');
    const code = readFileSync(compPath, 'utf-8');
    assert.match(code, /shortcut-help-close/, 'should have close button CSS class');
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-019: ? shortcut suppressed in input fields
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-019: ? suppressed in input fields', () => {
  it('useKeyboardNavigation suppresses ? when editing target is active', () => {
    const hookPath = path.join(srcDir, 'hooks', 'useKeyboardNavigation.js');
    const code = readFileSync(hookPath, 'utf-8');

    // The hook checks isEditingTarget and suppresses non-Escape keys
    assert.match(code, /isEditingTarget/, 'should check for editing target');
    // The check: if (editing && e.key !== 'Escape') return;
    assert.match(code, /editing\s*&&\s*e\.key\s*!==\s*['"]Escape['"]/, 'should suppress shortcuts when editing');
  });

  it('isEditingTarget checks INPUT, TEXTAREA, SELECT, contenteditable', () => {
    const hookPath = path.join(srcDir, 'hooks', 'useKeyboardNavigation.js');
    const code = readFileSync(hookPath, 'utf-8');
    assert.match(code, /INPUT/, 'should check for INPUT');
    assert.match(code, /TEXTAREA/, 'should check for TEXTAREA');
    assert.match(code, /SELECT/, 'should check for SELECT');
    assert.match(code, /isContentEditable|contenteditable/, 'should check for contenteditable');
  });
});

/* ───────────────────────────────────────────────────────────
 *  i18n: shortcut help keys exist in all 5 locale files
 * ─────────────────────────────────────────────────────────── */
describe('i18n: shortcutHelp keys in all locales', () => {
  const locales = ['en', 'es', 'fr', 'ar', 'zh'];
  const requiredKeys = [
    'title', 'close', 'footer',
    'sectionGlobal', 'sectionNews', 'sectionMap', 'sectionFilters', 'sectionEntities',
    'openHelp', 'focusSearch', 'saveView', 'refresh', 'toggleGlobe', 'toggleFilters',
    'closePanels', 'commandSearch', 'navDown', 'navUp', 'expandItem', 'bookmark',
    'focusCycle', 'closeOverlay', 'drawerToggle', 'drawerClose',
  ];

  for (const locale of locales) {
    it(`shortcutHelp keys exist in ${locale}.json`, () => {
      const filePath = path.join(srcDir, 'i18n', 'locales', `${locale}.json`);
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      assert.ok(content.shortcutHelp, `shortcutHelp section should exist in ${locale}.json`);
      for (const key of requiredKeys) {
        assert.ok(
          content.shortcutHelp[key] && content.shortcutHelp[key].length > 0,
          `shortcutHelp.${key} should be non-empty in ${locale}.json`,
        );
      }
    });
  }
});
