import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

describe('performance optimization', () => {
  describe('React.lazy code splitting', () => {
    it('App.jsx uses React.lazy for Globe component', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      assert.match(code, /const\s+Globe\s*=\s*lazy\s*\(\s*\(\)\s*=>\s*import\s*\(/);
    });

    it('App.jsx uses React.lazy for FlatMap component', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      assert.match(code, /const\s+FlatMap\s*=\s*lazy\s*\(\s*\(\)\s*=>\s*import\s*\(/);
    });

    it('EntityExplorerPage uses React.lazy for EntityRelationshipGraph', () => {
      const code = readFileSync(join(SRC, 'pages/EntityExplorerPage.jsx'), 'utf-8');
      assert.match(code, /const\s+EntityRelationshipGraph\s*=\s*lazy\s*\(\s*\(\)\s*=>\s*import\s*\(/);
    });

    it('Globe component is not statically imported in App.jsx', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      // Should NOT have a static import like: import Globe from './components/Globe'
      const staticImport = /^import\s+Globe\s+from\s+['"]\.\/components\/Globe/m;
      assert.ok(!staticImport.test(code), 'Globe should be lazy-loaded, not statically imported');
    });

    it('FlatMap component is not statically imported in App.jsx', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      const staticImport = /^import\s+FlatMap\s+from\s+['"]\.\/components\/FlatMap/m;
      assert.ok(!staticImport.test(code), 'FlatMap should be lazy-loaded, not statically imported');
    });
  });

  describe('Map architecture (unified AppMap + mapcn)', () => {
    it('Globe.jsx imports AppMap', () => {
      const code = readFileSync(join(SRC, 'components/Globe.jsx'), 'utf-8');
      assert.match(code, /import\s+AppMap\s+from\s+['"].*AppMap['"]/);
    });

    it('FlatMap.jsx imports AppMap', () => {
      const code = readFileSync(join(SRC, 'components/FlatMap.jsx'), 'utf-8');
      assert.match(code, /import\s+AppMap\s+from\s+['"].*AppMap['"]/);
    });

    it('Three.js is NOT imported in App.jsx', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      assert.ok(!code.includes("from 'three'"), 'three should not be imported in App.jsx');
      assert.ok(!code.includes("from 'react-globe.gl'"), 'react-globe.gl should not be imported in App.jsx');
    });

    it('Globe.jsx does not import react-globe.gl after mapcn migration', () => {
      const code = readFileSync(join(SRC, 'components/Globe.jsx'), 'utf-8');
      assert.ok(!/from\s+['"]react-globe\.gl['"]/.test(code), 'Globe.jsx should no longer import react-globe.gl');
      assert.ok(!/from\s+['"]three['"]/.test(code), 'Globe.jsx should no longer import three');
    });

    it('FlatMap.jsx does not import react-map-gl after mapcn migration', () => {
      const code = readFileSync(join(SRC, 'components/FlatMap.jsx'), 'utf-8');
      assert.ok(!/from\s+['"]react-map-gl/.test(code), 'FlatMap.jsx should no longer import react-map-gl');
    });
  });

  describe('Suspense loading states', () => {
    it('App.jsx has a Suspense fallback that is not null for map components', () => {
      const code = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
      assert.match(code, /Suspense\s+fallback=\{<MapLoadingFallback/,
        'App.jsx should use MapLoadingFallback as Suspense fallback');
    });

    it('MapLoadingFallback component exists', () => {
      assert.ok(existsSync(join(SRC, 'components/MapLoadingFallback.jsx')));
    });

    it('PageLoadingFallback component exists', () => {
      assert.ok(existsSync(join(SRC, 'components/PageLoadingFallback.jsx')));
    });

    it('main.jsx uses PageLoadingFallback for route Suspense boundaries', () => {
      const code = readFileSync(join(SRC, 'main.jsx'), 'utf-8');
      assert.match(code, /PageLoadingFallback/, 'main.jsx should import PageLoadingFallback');
      // Verify none of the Suspense fallbacks are null
      assert.ok(!code.includes('fallback={null}'), 'No Suspense fallback should be null');
    });

    it('MapLoadingFallback uses i18n', () => {
      const code = readFileSync(join(SRC, 'components/MapLoadingFallback.jsx'), 'utf-8');
      assert.match(code, /useTranslation/, 'should use useTranslation');
      assert.match(code, /t\(/, 'should call t() for translated text');
    });
  });

  describe('virtual scrolling / progressive rendering in NewsPanel', () => {
    it('NewsPanel imports useProgressiveList hook', () => {
      const code = readFileSync(join(SRC, 'components/NewsPanel.jsx'), 'utf-8');
      assert.match(code, /useProgressiveList/, 'should import useProgressiveList');
    });

    it('useProgressiveList hook exists', () => {
      assert.ok(existsSync(join(SRC, 'hooks/useProgressiveList.js')));
    });

    it('NewsPanel renders visibleNews (not all news) for progressive loading', () => {
      const code = readFileSync(join(SRC, 'components/NewsPanel.jsx'), 'utf-8');
      assert.match(code, /visibleNews\.map/, 'should iterate over visibleNews, not news');
    });

    it('NewsPanel has a load-more sentinel element', () => {
      const code = readFileSync(join(SRC, 'components/NewsPanel.jsx'), 'utf-8');
      assert.match(code, /news-panel-load-more-sentinel/, 'should have sentinel element');
    });

    it('useProgressiveList uses IntersectionObserver for efficient scroll detection', () => {
      const code = readFileSync(join(SRC, 'hooks/useProgressiveList.js'), 'utf-8');
      assert.match(code, /IntersectionObserver/, 'should use IntersectionObserver');
    });
  });

  describe('i18n keys for loading states', () => {
    it('en.json has loading.map key', () => {
      const locale = JSON.parse(readFileSync(join(SRC, 'i18n/locales/en.json'), 'utf-8'));
      assert.ok(locale.loading?.map, 'should have loading.map key');
    });

    it('en.json has loading.page key', () => {
      const locale = JSON.parse(readFileSync(join(SRC, 'i18n/locales/en.json'), 'utf-8'));
      assert.ok(locale.loading?.page, 'should have loading.page key');
    });

    it('en.json has panel.loadingMore key', () => {
      const locale = JSON.parse(readFileSync(join(SRC, 'i18n/locales/en.json'), 'utf-8'));
      assert.ok(locale.panel?.loadingMore, 'should have panel.loadingMore key');
    });
  });

});
