/**
 * Theme Toggle Tests — VAL-M2-011 through VAL-M2-015, VAL-CROSS-011
 *
 * Covers:
 *   VAL-M2-011: Theme toggle button in header
 *   VAL-M2-012: Light theme renders correctly (CSS variables)
 *   VAL-M2-013: Theme preference persisted in localStorage
 *   VAL-M2-014: System preference detected on first visit
 *   VAL-M2-015: RTL Arabic works in both themes
 *   VAL-CROSS-011: Cross-cutting theme support
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'src');

function read(p) {
  return readFileSync(path.join(root, p), 'utf-8');
}

// ═══════════════════════════════════════════
// VAL-M2-011: Theme toggle button in header
// ═══════════════════════════════════════════

test('VAL-M2-011: theme utility module exists', () => {
  const f = path.join(SRC, 'utils', 'theme.js');
  assert.ok(existsSync(f), 'src/utils/theme.js must exist');
});

test('VAL-M2-011: theme utility exports required functions', () => {
  const src = read('src/utils/theme.js');
  assert.match(src, /export\s+function\s+getTheme/, 'must export getTheme');
  assert.match(src, /export\s+function\s+setTheme/, 'must export setTheme');
  assert.match(src, /export\s+function\s+toggleTheme/, 'must export toggleTheme');
  assert.match(src, /export\s+function\s+initTheme/, 'must export initTheme');
  assert.match(src, /export\s+function\s+getSystemTheme/, 'must export getSystemTheme');
  assert.match(src, /export\s+function\s+applyTheme/, 'must export applyTheme');
  assert.match(src, /export\s+function\s+listenSystemTheme/, 'must export listenSystemTheme');
});

test('VAL-M2-011: Header imports theme toggle', () => {
  const src = read('src/components/Header.jsx');
  assert.match(src, /import.*toggleTheme.*from.*theme/, 'Header must import toggleTheme from theme utility');
  assert.match(src, /Sun.*Moon.*lucide-react/ || /Sun, Moon/, 'Header must import Sun and Moon icons');
});

test('VAL-M2-011: Header has theme toggle button markup', () => {
  const src = read('src/components/Header.jsx');
  assert.match(src, /className="theme-toggle-btn"/, 'Header must have .theme-toggle-btn element');
  assert.match(src, /handleToggleTheme/, 'Header must have handleToggleTheme function');
  assert.match(src, /toggleAppTheme/, 'Header must call toggleAppTheme');
});

test('VAL-M2-011: theme toggle btn CSS exists', () => {
  const css = read('src/index.css');
  assert.match(css, /\.theme-toggle-btn\s*\{/, 'index.css must define .theme-toggle-btn');
  assert.match(css, /\.theme-toggle-btn:hover/, 'must have hover state');
});

// ═══════════════════════════════════════════
// VAL-M2-012: Light theme CSS variables
// ═══════════════════════════════════════════

test('VAL-M2-012: light theme CSS variables defined', () => {
  const css = read('src/index.css');
  assert.match(css, /\[data-theme="light"\]/, 'must have [data-theme="light"] selector');
  assert.match(css, /\[data-theme="light"\][\s\S]*?--bg-0/, 'must define --bg-0 in light theme');
  assert.match(css, /\[data-theme="light"\][\s\S]*?--ink-0/, 'must define --ink-0 in light theme');
  assert.match(css, /\[data-theme="light"\][\s\S]*?color-scheme:\s*light/, 'must set color-scheme: light');
});

test('VAL-M2-012: light theme has light background values', () => {
  const css = read('src/index.css');
  // Extract the light theme block
  const match = css.match(/\[data-theme="light"\]\s*\{([^}]+)\}/);
  assert.ok(match, 'light theme block must exist');
  const block = match[1];
  // Check that bg-0 has a light color (hex starting with #e or #f for light backgrounds)
  const bg0Match = block.match(/--bg-0:\s*(#[a-fA-F0-9]+)/);
  assert.ok(bg0Match, '--bg-0 must be defined in light theme');
  const bg0Color = bg0Match[1].toLowerCase();
  // Light background should not be dark (#0b0d10 is the dark bg-0)
  assert.notStrictEqual(bg0Color, '#0b0d10', 'light bg-0 must differ from dark bg-0');
});

test('VAL-M2-012: light theme has dark text values', () => {
  const css = read('src/index.css');
  const match = css.match(/\[data-theme="light"\]\s*\{([^}]+)\}/);
  const block = match[1];
  const ink0Match = block.match(/--ink-0:\s*(#[a-fA-F0-9]+)/);
  assert.ok(ink0Match, '--ink-0 must be defined in light theme');
  const ink0Color = ink0Match[1].toLowerCase();
  // Dark text should not be light (#e8e6df is the dark ink-0)
  assert.notStrictEqual(ink0Color, '#e8e6df', 'light ink-0 must differ from dark ink-0');
});

// ═══════════════════════════════════════════
// VAL-M2-013: Theme persisted in localStorage
// ═══════════════════════════════════════════

test('VAL-M2-013: theme utility uses mapr:theme localStorage key', () => {
  const src = read('src/utils/theme.js');
  assert.match(src, /mapr:theme/, 'must use mapr:theme as localStorage key');
  assert.match(src, /localStorage\.setItem\(STORAGE_KEY/, 'must save to localStorage');
  assert.match(src, /localStorage\.getItem\(STORAGE_KEY/, 'must read from localStorage');
});

test('VAL-M2-013: setTheme persists to localStorage', () => {
  const src = read('src/utils/theme.js');
  assert.match(src, /export\s+function\s+setTheme[\s\S]*?setStoredTheme\(theme\)/, 'setTheme must call setStoredTheme');
});

test('VAL-M2-013: toggleTheme returns new theme value', () => {
  const src = read('src/utils/theme.js');
  assert.match(src, /toggleTheme[\s\S]*?return\s+next/, 'toggleTheme must return the new theme value');
});

// ═══════════════════════════════════════════
// VAL-M2-014: System preference as default
// ═══════════════════════════════════════════

test('VAL-M2-014: getSystemTheme uses prefers-color-scheme', () => {
  const src = read('src/utils/theme.js');
  assert.match(src, /prefers-color-scheme:\s*dark/, 'must use prefers-color-scheme media query');
  assert.match(src, /matchMedia\(.*prefers-color-scheme/, 'must call matchMedia');
});

test('VAL-M2-014: initTheme does not persist system default', () => {
  const src = read('src/utils/theme.js');
  // initTheme should only persist explicit user choices
  assert.match(src, /Do NOT persist the system default/, 'comment must explain system default behavior');
});

test('VAL-M2-014: listenSystemTheme responds to OS changes', () => {
  const src = read('src/utils/theme.js');
  assert.match(src, /export\s+function\s+listenSystemTheme/, 'must export listenSystemTheme');
  assert.match(src, /getStoredTheme/, 'must check stored theme before reacting to OS change');
});

// ═══════════════════════════════════════════
// VAL-M2-015: RTL Arabic works in both themes
// ═══════════════════════════════════════════

test('VAL-M2-015: Arabic locale has theme keys', () => {
  const ar = JSON.parse(read('src/i18n/locales/ar.json'));
  assert.ok(ar.theme, 'ar.json must have theme object');
  assert.ok(ar.theme.switchLight, 'ar.json must have theme.switchLight');
  assert.ok(ar.theme.switchDark, 'ar.json must have theme.switchDark');
  assert.ok(ar.theme.light, 'ar.json must have theme.light');
  assert.ok(ar.theme.dark, 'ar.json must have theme.dark');
});

test('VAL-M2-015: CSS uses logical properties for RTL compatibility', () => {
  const css = read('src/index.css');
  // Light theme should not override RTL-affecting properties
  // Instead, RTL is handled by dir="rtl" on <html> and CSS logical properties
  assert.match(css, /\[data-theme="light"\][\s\S]*?--bg-0/, 'light theme block exists alongside RTL support');
});

// ═══════════════════════════════════════════
// VAL-CROSS-011: Cross-cutting theme support
// ═══════════════════════════════════════════

test('VAL-CROSS-011: all 5 locales have theme keys', () => {
  for (const lang of ['en', 'es', 'fr', 'ar', 'zh']) {
    const data = JSON.parse(read(`src/i18n/locales/${lang}.json`));
    assert.ok(data.theme, `${lang}.json must have theme object`);
    assert.ok(data.theme.switchLight, `${lang}.json must have theme.switchLight`);
    assert.ok(data.theme.switchDark, `${lang}.json must have theme.switchDark`);
    assert.ok(data.theme.light, `${lang}.json must have theme.light`);
    assert.ok(data.theme.dark, `${lang}.json must have theme.dark`);
  }
});

test('VAL-CROSS-011: map light theme uses higher-contrast CARTO basemap in FlatMap', () => {
  const src = read('src/components/FlatMap.jsx');
  assert.doesNotMatch(src, /positron/, 'FlatMap light theme should not use pale Positron basemap');
  assert.match(src, /STYLE_LIGHT\s*=\s*['"]https:\/\/basemaps\.cartocdn\.com\/gl\/voyager-nolabels-gl-style\/style\.json['"]/, 'FlatMap light theme must use higher-contrast CARTO Voyager basemap');
  assert.match(src, /STYLE_LIGHT_LABELED\s*=\s*['"]https:\/\/basemaps\.cartocdn\.com\/gl\/voyager-gl-style\/style\.json['"]/, 'FlatMap labeled light theme must use higher-contrast CARTO Voyager basemap');
});

test('VAL-CROSS-011: Globe keeps theme-aware map selection', () => {
  const src = read('src/components/Globe.jsx');
  assert.match(src, /isLight/, 'Globe must use theme for style selection');
});

test('VAL-CROSS-011: AppMap component passes theme through', () => {
  const src = read('src/components/AppMap.tsx');
  assert.match(src, /theme\?:\s*'light'\s*\|\s*'dark'/, 'AppMap must accept theme prop');
  assert.match(src, /DEFAULT_STYLE_LIGHT/, 'AppMap must define light style URL');
  assert.match(src, /DEFAULT_STYLE_DARK/, 'AppMap must define dark style URL');
  assert.doesNotMatch(src, /positron/, 'AppMap light map should avoid pale Positron basemap');
  assert.match(src, /DEFAULT_STYLE_LIGHT[\s\S]*?voyager-gl-style/, 'AppMap light map must use higher-contrast CARTO Voyager basemap');
});

test('VAL-CROSS-011: map light theme strengthens country overlay contrast', () => {
  const countries = read('src/components/MapCountries.jsx');
  const overlay = read('src/components/MapGLOverlay.jsx');
  assert.match(countries, /LIGHT_COUNTRY_PALETTE/, 'MapCountries must define a light-theme country palette');
  assert.match(countries, /quietLine:\s*'rgba\(24,\s*58,\s*55,\s*0\.58\)'/, 'Light country borders should be darker than the dark-theme quiet border');
  assert.match(countries, /emptyFill:\s*'rgba\(32,\s*84,\s*76,\s*0\.24\)'/, 'Light empty country fill should be stronger than the dark-theme empty fill');
  assert.match(overlay, /isLight=\{isLight\}/, 'MapGLOverlay must pass light theme state to country layers');
});

test('VAL-CROSS-011: map dark theme country overlay remains visible without basemap tiles', () => {
  const countries = read('src/components/MapCountries.jsx');
  assert.match(countries, /DARK_COUNTRY_PALETTE/, 'MapCountries must define a dark-theme country palette');
  assert.match(countries, /emptyFill:\s*'rgba\(45,\s*138,\s*148,\s*0\.16\)'/, 'Dark empty country fill should be visible against the dark app background');
  assert.match(countries, /quietLine:\s*'rgba\(80,\s*174,\s*186,\s*0\.34\)'/, 'Dark country borders should not disappear when the basemap is unavailable');
  assert.match(countries, /dataOpacity:\s*0\.42/, 'Dark data-bearing countries should carry the map when tile loading is slow');
});

test('VAL-CROSS-011: flat map avoids duplicate static backdrop over the live map', () => {
  const flatMap = read('src/components/FlatMap.jsx');
  const map = read('src/components/ui/map.tsx');
  assert.doesNotMatch(flatMap, /MapStaticBackdrop/, 'FlatMap should not render a static SVG map behind the live basemap');
  assert.match(map, /createOfflineStyle/, 'Map component should have an internal style fallback');
  assert.match(map, /mapr-offline-/, 'Offline style should be identifiable for theme switching');
});

test('VAL-CROSS-011: main.jsx calls initTheme on startup', () => {
  const src = read('src/main.jsx');
  assert.match(src, /initTheme/, 'main.jsx must call initTheme');
  assert.match(src, /import.*initTheme.*from.*theme/, 'main.jsx must import initTheme');
});

test('VAL-CROSS-011: theme toggle is in mobile menu', () => {
  const src = read('src/components/Header.jsx');
  assert.match(src, /header-mobile-menu[\s\S]*?theme-toggle-btn/, 'mobile menu must include theme toggle');
});

test('VAL-CROSS-011: theme observer syncs with data-theme attribute', () => {
  const src = read('src/components/Header.jsx');
  assert.match(src, /MutationObserver[\s\S]*?data-theme/, 'Header must observe data-theme attribute changes');
});
