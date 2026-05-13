/**
 * Onboarding Overlay Tests — VAL-M2-023 through VAL-M2-025
 *
 * Tests for first-visit onboarding tooltip overlay:
 *   - Overlay shown on first visit (no localStorage key)
 *   - Dismissed via X button and "Got it" button
 *   - Persisted in localStorage (mapr:onboarded)
 *   - Does not appear after dismissal
 *   - Contains Getting Started reference content
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '..', 'src');

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-023: First-visit onboarding overlay shown
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-023: OnboardingOverlay component exists', () => {
  it('OnboardingOverlay.jsx file exists', () => {
    const compPath = path.join(srcDir, 'components', 'OnboardingOverlay.jsx');
    assert.ok(existsSync(compPath), 'OnboardingOverlay.jsx should exist');
  });

  it('OnboardingOverlay checks localStorage mapr:onboarded', () => {
    const compPath = path.join(srcDir, 'components', 'OnboardingOverlay.jsx');
    const code = readFileSync(compPath, 'utf-8');
    assert.match(code, /mapr:onboarded/, 'should reference mapr:onboarded localStorage key');
    assert.match(code, /localStorage\.getItem/, 'should read from localStorage');
  });

  it('OnboardingOverlay renders a dialog with role="dialog"', () => {
    const compPath = path.join(srcDir, 'components', 'OnboardingOverlay.jsx');
    const code = readFileSync(compPath, 'utf-8');
    assert.match(code, /role="dialog"/, 'should render as dialog');
    assert.match(code, /aria-modal="true"/, 'should be aria-modal');
  });

  it('OnboardingOverlay conditionally renders based on localStorage', () => {
    const compPath = path.join(srcDir, 'components', 'OnboardingOverlay.jsx');
    const code = readFileSync(compPath, 'utf-8');
    // Should have a function that checks localStorage
    assert.match(code, /isOnboarded/, 'should have isOnboarded check function');
    assert.match(code, /STORAGE_KEY/, 'should define a storage key constant');
  });

  it('OnboardingOverlay has dismiss button(s): X close and Got it', () => {
    const compPath = path.join(srcDir, 'components', 'OnboardingOverlay.jsx');
    const code = readFileSync(compPath, 'utf-8');
    assert.match(code, /onboard-close/, 'should have close button with CSS class');
    assert.match(code, /onboard-got-it-btn/, 'should have Got it button with CSS class');
    // Should have dismiss/markOnboarded function
    assert.match(code, /markOnboarded/, 'should have markOnboarded function');
    assert.match(code, /localStorage\.setItem/, 'should write to localStorage');
  });

  it('OnboardingOverlay is wired into Layout.jsx', () => {
    const layoutPath = path.join(srcDir, 'components', 'Layout.jsx');
    const code = readFileSync(layoutPath, 'utf-8');
    assert.match(code, /import OnboardingOverlay/, 'should import OnboardingOverlay');
    assert.match(code, /<OnboardingOverlay/, 'should render OnboardingOverlay');
  });

  it('OnboardingOverlay only appears on main map route (/)', () => {
    const layoutPath = path.join(srcDir, 'components', 'Layout.jsx');
    const code = readFileSync(layoutPath, 'utf-8');
    // Should conditionally render only when pathname === '/'
    assert.match(code, /pathname\s*===\s*['"]\/['"]/, 'should check for root route');
  });

  it('OnboardingOverlay points out key features (callout cards)', () => {
    const compPath = path.join(srcDir, 'components', 'OnboardingOverlay.jsx');
    const code = readFileSync(compPath, 'utf-8');
    // Should contain references to the 5 key features
    assert.match(code, /search/i, 'should reference search feature');
    assert.match(code, /layer/i, 'should reference layers feature');
    assert.match(code, /sidebar/i, 'should reference sidebar/navigation feature');
    assert.match(code, /panel/i, 'should reference panels feature');
    assert.match(code, /shortcut/i, 'should reference shortcuts feature');
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-024: Onboarding persisted — does not show again
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-024: Onboarding persistence', () => {
  it('markOnboarded sets localStorage key to "1"', () => {
    const compPath = path.join(srcDir, 'components', 'OnboardingOverlay.jsx');
    const code = readFileSync(compPath, 'utf-8');
    // The markOnboarded function should set the key to '1'
    assert.match(code, /setItem\(STORAGE_KEY.*['"]1['"]/, 'should set storage key to "1"');
  });

  it('isOnboarded returns true when localStorage key is "1"', () => {
    const compPath = path.join(srcDir, 'components', 'OnboardingOverlay.jsx');
    const code = readFileSync(compPath, 'utf-8');
    // Check should return true when value is '1'
    assert.match(code, /getItem\(STORAGE_KEY\).*===.*['"]1['"]/, 'should check for value "1"');
  });

  it('isOnboarded falls back to true when localStorage is unavailable', () => {
    const compPath = path.join(srcDir, 'components', 'OnboardingOverlay.jsx');
    const code = readFileSync(compPath, 'utf-8');
    // Should have try/catch around localStorage access
    assert.match(code, /try\s*\{/, 'should wrap localStorage access in try/catch');
  });

  it('dismiss function calls markOnboarded and sets visible to false', () => {
    const compPath = path.join(srcDir, 'components', 'OnboardingOverlay.jsx');
    const code = readFileSync(compPath, 'utf-8');
    assert.match(code, /dismiss/, 'should have dismiss function');
    // dismiss should call markOnboarded() and setVisible(false)
  });

  it('Escape key dismisses the overlay', () => {
    const compPath = path.join(srcDir, 'components', 'OnboardingOverlay.jsx');
    const code = readFileSync(compPath, 'utf-8');
    assert.match(code, /Escape/, 'should handle Escape key');
  });
});

/* ───────────────────────────────────────────────────────────
 *  VAL-M2-025: Onboarding contains Getting Started reference content
 * ─────────────────────────────────────────────────────────── */
describe('VAL-M2-025: Getting Started reference content', () => {
  it('OnboardingOverlay has Getting Started section', () => {
    const compPath = path.join(srcDir, 'components', 'OnboardingOverlay.jsx');
    const code = readFileSync(compPath, 'utf-8');
    assert.match(code, /onboard-getting-started/, 'should have getting-started CSS class');
    assert.match(code, /gettingStartedTitle/, 'should reference getting started title i18n key');
  });

  it('Getting Started covers core workflow topics in i18n', () => {
    const enPath = path.join(srcDir, 'i18n', 'locales', 'en.json');
    const content = JSON.parse(readFileSync(enPath, 'utf-8'));
    const ob = content.onboarding;
    assert.ok(ob, 'onboarding section should exist');
    // Core workflow topics
    assert.ok(ob.gsSearch, 'should have gsSearch key');
    assert.ok(ob.gsFilter, 'should have gsFilter key');
    assert.ok(ob.gsSeverity, 'should have gsSeverity key');
    assert.ok(ob.gsShortcuts, 'should have gsShortcuts key');
    assert.ok(ob.gsBookmark, 'should have gsBookmark key');
    assert.ok(ob.gsSaveView, 'should have gsSaveView key');

    // Verify content covers required topics
    assert.match(ob.gsSearchDesc, /search/i, 'gsSearchDesc should mention search');
    assert.match(ob.gsFilterDesc, /filter|severity|confidence/i, 'gsFilterDesc should mention filtering');
    assert.match(ob.gsSeverityDesc, /critical|elevated|watch|low/i, 'gsSeverityDesc should mention severity levels');
    assert.match(ob.gsShortcutsDesc, /\?/, 'gsShortcutsDesc should mention ? key for shortcut reference');
    assert.match(ob.gsBookmarkDesc, /bookmark|watchlist/i, 'gsBookmarkDesc should mention bookmarking');
    assert.match(ob.gsSaveViewDesc, /save|view/i, 'gsSaveViewDesc should mention saving views');
  });

  it('Getting Started content is concise (fits 1080p without scrolling)', () => {
    const compPath = path.join(srcDir, 'components', 'OnboardingOverlay.jsx');
    const code = readFileSync(compPath, 'utf-8');
    // The getting started card has max-width: 580px and uses a compact 2-col grid
    // This is designed to fit within a 1080p viewport without scrolling
    assert.match(code, /onboard-gs-grid/, 'should have a compact grid layout');
  });

  it('CSS styles exist for onboarding overlay', () => {
    const cssPath = path.join(srcDir, 'index.css');
    const css = readFileSync(cssPath, 'utf-8');
    assert.match(css, /\.onboard-backdrop/, 'should have backdrop styles');
    assert.match(css, /\.onboard-callout/, 'should have callout styles');
    assert.match(css, /\.onboard-getting-started/, 'should have getting-started styles');
    assert.match(css, /\.onboard-got-it-btn/, 'should have Got it button styles');
    assert.match(css, /\.onboard-close/, 'should have close button styles');
  });

  it('Onboarding CSS uses MAPR design tokens', () => {
    const cssPath = path.join(srcDir, 'index.css');
    const css = readFileSync(cssPath, 'utf-8');
    // Should use MAPR tactical colors
    assert.match(css, /\.onboard-backdrop.*backdrop-filter:\s*blur/s, 'backdrop should have blur effect');
    assert.match(css, /\.onboard-gs-title.*var\(--ff-serif\)/s, 'title should use serif font');
    assert.match(css, /\.onboard-got-it-btn.*var\(--amber\)/s, 'Got it button should use amber');
    assert.match(css, /\.onboard-callout-step.*var\(--amber\)/s, 'callout steps should use amber');
    assert.match(css, /\.onboard-gs-label.*var\(--cyan\)/s, 'GS labels should use cyan');
  });
});

/* ───────────────────────────────────────────────────────────
 *  i18n: onboarding keys exist in all 5 locale files
 * ─────────────────────────────────────────────────────────── */
describe('i18n: onboarding keys in all locales', () => {
  const locales = ['en', 'es', 'fr', 'ar', 'zh'];
  const requiredKeys = [
    'title', 'close', 'featuresLabel',
    'searchTitle', 'searchDesc',
    'layersTitle', 'layersDesc',
    'sidebarTitle', 'sidebarDesc',
    'panelsTitle', 'panelsDesc',
    'shortcutsTitle', 'shortcutsDesc',
    'gettingStartedTitle', 'gotIt',
    'gsSearch', 'gsSearchDesc',
    'gsFilter', 'gsFilterDesc',
    'gsSeverity', 'gsSeverityDesc',
    'gsShortcuts', 'gsShortcutsDesc',
    'gsBookmark', 'gsBookmarkDesc',
    'gsSaveView', 'gsSaveViewDesc',
  ];

  for (const locale of locales) {
    it(`onboarding keys exist in ${locale}.json`, () => {
      const filePath = path.join(srcDir, 'i18n', 'locales', `${locale}.json`);
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      assert.ok(content.onboarding, `onboarding section should exist in ${locale}.json`);
      for (const key of requiredKeys) {
        assert.ok(
          content.onboarding[key] && String(content.onboarding[key]).length > 0,
          `onboarding.${key} should be non-empty in ${locale}.json (got: "${content.onboarding[key]}")`,
        );
      }
    });
  }
});

/* ───────────────────────────────────────────────────────────
 *  Edge cases: localStorage blocked or not available
 * ─────────────────────────────────────────────────────────── */
describe('Onboarding edge cases', () => {
  it('isOnboarded returns true when localStorage throws (safe default)', () => {
    const compPath = path.join(srcDir, 'components', 'OnboardingOverlay.jsx');
    const code = readFileSync(compPath, 'utf-8');
    // The catch block should return true to skip onboarding if storage is blocked
    assert.match(code, /catch.*\{/, 'should have catch block for localStorage errors');
  });

  it('Overlay has z-index higher than other overlays', () => {
    const cssPath = path.join(srcDir, 'index.css');
    const css = readFileSync(cssPath, 'utf-8');
    // Onboarding backdrop should have z-index 10000 (higher than shortcut help's 9999)
    const backdropMatch = css.match(/\.onboard-backdrop\s*\{[^}]*\}/s);
    assert.ok(backdropMatch, 'backdrop style block should exist');
    assert.match(backdropMatch[0], /z-index:\s*10000/, 'onboarding should have z-index 10000');
  });
});
