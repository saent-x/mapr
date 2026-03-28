import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

describe('accessibility and UX polish', () => {
  describe('focus indicators (VAL-POLISH-003)', () => {
    it('index.css has global :focus-visible rule', () => {
      const css = readFileSync(join(SRC, 'index.css'), 'utf-8');
      assert.match(css, /:focus-visible\s*\{/, 'Should have global :focus-visible styles');
    });

    it('focus-visible uses accent color outline', () => {
      const css = readFileSync(join(SRC, 'index.css'), 'utf-8');
      assert.ok(
        css.includes('outline: 2px solid var(--accent'),
        'Focus indicator should use 2px accent color outline'
      );
    });

    it('focus-visible styles apply to buttons and links', () => {
      const css = readFileSync(join(SRC, 'index.css'), 'utf-8');
      assert.match(css, /button:focus-visible/, 'Should style button:focus-visible');
      assert.match(css, /a:focus-visible/, 'Should style a:focus-visible');
    });

    it('focus-visible styles apply to nav links', () => {
      const css = readFileSync(join(SRC, 'index.css'), 'utf-8');
      assert.match(css, /\.layout-nav-link:focus-visible/, 'Should style layout nav link focus');
    });

    it('focus-visible styles apply to filter toggles', () => {
      const css = readFileSync(join(SRC, 'index.css'), 'utf-8');
      assert.match(css, /\.filter-toggle:focus-visible/, 'Should style filter toggle focus');
      assert.match(css, /\.anomaly-toggle:focus-visible/, 'Should style anomaly toggle focus');
      assert.match(css, /\.watchlist-toggle:focus-visible/, 'Should style watchlist toggle focus');
    });

    it('text inputs get border-color change on focus-visible', () => {
      const css = readFileSync(join(SRC, 'index.css'), 'utf-8');
      assert.match(css, /input\[type="text"\]:focus-visible/, 'Should style text input focus');
    });

    it('mouse clicks suppress default outline via :focus:not(:focus-visible)', () => {
      const css = readFileSync(join(SRC, 'index.css'), 'utf-8');
      assert.match(css, /:focus:not\(:focus-visible\)/, 'Should suppress outline for mouse focus');
    });
  });

  describe('keyboard navigation', () => {
    it('App.jsx Escape closes panels, drawers, and overlays', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      assert.match(code, /case 'Escape'/, 'Should handle Escape key');
      assert.match(code, /handleClosePanel/, 'Escape should close news panel');
      assert.match(code, /setDrawerMode\(null\)/, 'Escape should close drawer');
    });

    it('Escape closes export dialog and save dialog', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      assert.match(code, /showExport.*setShowExport\(false\)/, 'Escape should close export dialog');
      assert.match(code, /showSaveDialog.*setShowSaveDialog\(false\)/, 'Escape should close save dialog');
    });

    it('Escape closes anomaly and watchlist panels', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      assert.match(code, /anomalyPanelOpen.*setAnomalyPanelOpen\(false\)/, 'Escape should close anomaly panel');
      assert.match(code, /watchlistPanelOpen.*setWatchlistPanelOpen\(false\)/, 'Escape should close watchlist panel');
    });

    it('Escape works even when focused on input fields', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      // The Escape key should work even from inputs
      assert.match(
        code,
        /e\.key\s*!==\s*'Escape'\s*&&.*INPUT/,
        'Escape should bypass the input guard so it works from any field'
      );
    });

    it('interactive elements have aria-labels', () => {
      const newsPanel = readFileSync(join(SRC, 'components/NewsPanel.jsx'), 'utf-8');
      assert.match(newsPanel, /aria-label/, 'NewsPanel should have aria-labels on buttons');

      const filterDrawer = readFileSync(join(SRC, 'components/FilterDrawer.jsx'), 'utf-8');
      assert.match(filterDrawer, /aria-label/, 'FilterDrawer should have aria-labels on buttons');
    });

    it('drawer toggle buttons use aria-pressed', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      assert.match(code, /aria-pressed/, 'Toggle buttons should use aria-pressed');
    });
  });

  describe('loading states (VAL-POLISH-004)', () => {
    it('DataLoadingOverlay component exists', () => {
      assert.ok(
        existsSync(join(SRC, 'components/DataLoadingOverlay.jsx')),
        'DataLoadingOverlay.jsx should exist'
      );
    });

    it('DataLoadingOverlay uses role="status" and aria-live', () => {
      const code = readFileSync(join(SRC, 'components/DataLoadingOverlay.jsx'), 'utf-8');
      assert.match(code, /role="status"/, 'Should have role=status');
      assert.match(code, /aria-live/, 'Should have aria-live for screen readers');
    });

    it('DataLoadingOverlay uses i18n for text', () => {
      const code = readFileSync(join(SRC, 'components/DataLoadingOverlay.jsx'), 'utf-8');
      assert.match(code, /useTranslation/, 'Should use i18n');
      assert.match(code, /t\('loading\.initialData'\)/, 'Should use loading.initialData key');
    });

    it('DataLoadingOverlay includes skeleton cards', () => {
      const code = readFileSync(join(SRC, 'components/DataLoadingOverlay.jsx'), 'utf-8');
      assert.match(code, /skeleton/, 'Should include skeleton loading indicators');
    });

    it('App.jsx shows DataLoadingOverlay when loading with no data', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      assert.match(code, /dataSource\s*===\s*'loading'\s*&&\s*!liveNews/, 'Should check for loading state with no data');
      assert.match(code, /DataLoadingOverlay/, 'Should render DataLoadingOverlay');
    });

    it('CSS has data-loading-overlay styles', () => {
      const css = readFileSync(join(SRC, 'index.css'), 'utf-8');
      assert.match(css, /\.data-loading-overlay\b/, 'Should have loading overlay styles');
      assert.match(css, /\.data-loading-overlay-icon/, 'Should have loading overlay icon styles');
    });

    it('i18n has loading.initialData key', () => {
      const en = JSON.parse(readFileSync(join(SRC, 'i18n/locales/en.json'), 'utf-8'));
      assert.ok(en.loading.initialData, 'Should have loading.initialData key');
    });
  });

  describe('error states (VAL-POLISH-005)', () => {
    it('DataErrorBanner component exists', () => {
      assert.ok(
        existsSync(join(SRC, 'components/DataErrorBanner.jsx')),
        'DataErrorBanner.jsx should exist'
      );
    });

    it('DataErrorBanner uses role="alert" for accessibility', () => {
      const code = readFileSync(join(SRC, 'components/DataErrorBanner.jsx'), 'utf-8');
      assert.match(code, /role="alert"/, 'Should have role=alert for error messages');
    });

    it('DataErrorBanner has a retry button', () => {
      const code = readFileSync(join(SRC, 'components/DataErrorBanner.jsx'), 'utf-8');
      assert.match(code, /onRetry/, 'Should accept an onRetry prop');
      assert.match(code, /onClick=\{onRetry\}/, 'Retry button should call onRetry');
    });

    it('DataErrorBanner uses i18n for all text', () => {
      const code = readFileSync(join(SRC, 'components/DataErrorBanner.jsx'), 'utf-8');
      assert.match(code, /useTranslation/, 'Should use i18n');
      assert.match(code, /t\('errors\.backendUnreachable'\)/, 'Should use error title key');
      assert.match(code, /t\('errors\.retryAction'\)/, 'Should use retry action key');
    });

    it('App.jsx shows DataErrorBanner when data error occurs', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      assert.match(code, /dataError\s*&&\s*<DataErrorBanner/, 'Should show error banner on data error');
    });

    it('DataErrorBanner receives onRetry connected to handleRefresh', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      assert.match(code, /DataErrorBanner\s+onRetry=\{handleRefresh\}/, 'Should pass handleRefresh as onRetry');
    });

    it('CSS has data-error-banner styles', () => {
      const css = readFileSync(join(SRC, 'index.css'), 'utf-8');
      assert.match(css, /\.data-error-banner\b/, 'Should have error banner styles');
      assert.match(css, /\.data-error-banner-retry/, 'Should have retry button styles');
    });

    it('i18n has error state keys', () => {
      const en = JSON.parse(readFileSync(join(SRC, 'i18n/locales/en.json'), 'utf-8'));
      assert.ok(en.errors.backendUnreachable, 'Should have backendUnreachable key');
      assert.ok(en.errors.fallbackActive, 'Should have fallbackActive key');
      assert.ok(en.errors.retryAction, 'Should have retryAction key');
    });

    it('ErrorBoundary has a retry mechanism', () => {
      const code = readFileSync(join(SRC, 'components/ErrorBoundary.jsx'), 'utf-8');
      assert.match(code, /handleRetry/, 'ErrorBoundary should have retry functionality');
      assert.match(code, /error-boundary-retry/, 'ErrorBoundary should have a retry button');
    });
  });

  describe('no empty/broken states', () => {
    it('newsStore has mock data fallback when both sources fail', () => {
      const code = readFileSync(join(SRC, 'stores/newsStore.js'), 'utf-8');
      assert.match(code, /dataSource.*mock/, 'Should fall back to mock data source');
    });

    it('App.jsx imports MOCK_NEWS for fallback', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      assert.match(code, /MOCK_NEWS/, 'Should use MOCK_NEWS as fallback data');
    });

    it('MapLoadingFallback is rendered during lazy load', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      assert.match(code, /Suspense.*fallback.*MapLoadingFallback/s, 'Should have Suspense with MapLoadingFallback');
    });
  });
});
