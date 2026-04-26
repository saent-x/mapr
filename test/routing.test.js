import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');

describe('frontend routing', () => {
  it('main.jsx configures BrowserRouter with all required routes', () => {
    const src = readFileSync(join(SRC, 'main.jsx'), 'utf8');
    assert.ok(src.includes('BrowserRouter'), 'BrowserRouter must be used');
    assert.ok(src.includes('Routes'), 'Routes component must be used');
    // Required routes
    assert.ok(src.includes('path="/"') || src.includes("path='/'"), 'root route / must exist');
    assert.ok(
      src.includes('path="/region/:iso"') || src.includes("path='/region/:iso'"),
      'region route /region/:iso must exist',
    );
    assert.ok(
      src.includes('path="/admin"') || src.includes("path='/admin'"),
      'admin route /admin must exist',
    );
    assert.ok(
      src.includes('path="/entities"') || src.includes("path='/entities'"),
      'entities route /entities must exist',
    );
  });

  it('Layout component exists with navigation links', () => {
    const layoutPath = join(SRC, 'components', 'Layout.jsx');
    assert.ok(existsSync(layoutPath), 'Layout.jsx must exist in components/');
    const src = readFileSync(layoutPath, 'utf8');
    assert.ok(src.includes('Outlet'), 'Layout must use <Outlet> for child routes');
    assert.ok(src.includes('Link') || src.includes('NavLink'), 'Layout must use Link or NavLink for navigation');
    // Navigation targets
    assert.ok(src.includes('to="/"') || src.includes("to='/'"), 'Link to / must exist');
    // Admin sidebar link removed — /admin route still reachable via direct URL only
    assert.equal(
      src.includes('to="/admin"') || src.includes("to='/admin'"),
      false,
      'Link to /admin must NOT exist in sidebar (admin hidden from nav)',
    );
    assert.ok(src.includes('to="/entities"') || src.includes("to='/entities'"), 'Link to /entities must exist');
  });

  it('RegionDetailPage exists and reads the :iso param', () => {
    const pagePath = join(SRC, 'pages', 'RegionDetailPage.jsx');
    assert.ok(existsSync(pagePath), 'RegionDetailPage.jsx must exist');
    const src = readFileSync(pagePath, 'utf8');
    assert.ok(src.includes('useParams'), 'RegionDetailPage must use useParams for :iso');
    assert.ok(src.includes('iso'), 'Must reference the iso parameter');
  });

  it('AdminPage exists as a placeholder', () => {
    const pagePath = join(SRC, 'pages', 'AdminPage.jsx');
    assert.ok(existsSync(pagePath), 'AdminPage.jsx must exist');
    const src = readFileSync(pagePath, 'utf8');
    assert.ok(src.includes('export default'), 'Must have a default export');
  });

  it('EntityExplorerPage exists as a placeholder', () => {
    const pagePath = join(SRC, 'pages', 'EntityExplorerPage.jsx');
    assert.ok(existsSync(pagePath), 'EntityExplorerPage.jsx must exist');
    const src = readFileSync(pagePath, 'utf8');
    assert.ok(src.includes('export default'), 'Must have a default export');
  });

  it('TrendAnalysisPage exists with default export', () => {
    const pagePath = join(SRC, 'pages', 'TrendAnalysisPage.jsx');
    assert.ok(existsSync(pagePath), 'TrendAnalysisPage.jsx must exist');
    const src = readFileSync(pagePath, 'utf8');
    assert.ok(src.includes('export default'), 'Must have a default export');
  });

  it('trends route is configured in main.jsx', () => {
    const src = readFileSync(join(SRC, 'main.jsx'), 'utf8');
    assert.ok(
      src.includes('path="/trends"') || src.includes("path='/trends'"),
      'trends route /trends must exist',
    );
    assert.ok(src.includes('TrendAnalysisPage'), 'main.jsx must reference TrendAnalysisPage');
  });

  it('intel route is configured in main.jsx; /filters route retired', () => {
    const src = readFileSync(join(SRC, 'main.jsx'), 'utf8');
    assert.ok(
      src.includes('path="/intel"') || src.includes("path='/intel'"),
      'intel route /intel must exist',
    );
    assert.ok(src.includes('IntelPage'), 'main.jsx must reference IntelPage');
    assert.equal(
      src.includes('path="/filters"') || src.includes("path='/filters'"),
      false,
      '/filters route must be retired (Filters is now a map FAB BottomSheet)',
    );
    assert.equal(
      src.includes('FiltersPage'),
      false,
      'main.jsx must not reference FiltersPage (file deleted)',
    );
  });

  it('IntelPage exists with mobile-tab-page chrome; FiltersPage retired', () => {
    const intelPath = join(SRC, 'pages', 'IntelPage.jsx');
    assert.ok(existsSync(intelPath), 'IntelPage.jsx must exist in pages/');
    const intel = readFileSync(intelPath, 'utf8');
    assert.ok(intel.includes('export default'), 'IntelPage must export default');
    assert.ok(intel.includes('mobile-tab-page'), 'IntelPage must render mobile-tab-page container');
    assert.equal(
      existsSync(join(SRC, 'pages', 'FiltersPage.jsx')),
      false,
      'FiltersPage.jsx must be deleted (Filters now lives in MapFloatingIcons BottomSheet)',
    );
  });

  it('MobileBottomNav links to the 5 visible routes (admin hidden from nav)', () => {
    const src = readFileSync(join(SRC, 'components', 'MobileBottomNav.jsx'), 'utf8');
    // Each target must appear as a routable string literal somewhere in the file
    // (either as `to="/x"`, in a tab table like `to: '/x'`, or via a template
    // literal for the dynamic /region/{iso} link).
    const targets = ['/', '/entities', '/region', '/trends', '/intel'];
    for (const target of targets) {
      const escaped = target.replace(/[/]/g, '\\/');
      const re = new RegExp(`['"\`]${escaped}['"\`/]`);
      assert.ok(
        re.test(src) || (target === '/region' && /\/region\/\$\{/.test(src)),
        `MobileBottomNav must navigate to ${target}`,
      );
    }
    assert.equal(
      src.includes('to="/admin"') || src.includes("to='/admin'") || src.includes("'/admin'"),
      false,
      'MobileBottomNav must NOT navigate to /admin (admin hidden from nav, reachable by direct URL only)',
    );
    assert.equal(
      src.includes('to="/filters"') || src.includes("to='/filters'") || src.includes("'/filters'"),
      false,
      'MobileBottomNav must NOT navigate to /filters (route retired)',
    );
    assert.equal(
      /drawerMode|setDrawerMode|intel-mobile/.test(src),
      false,
      'MobileBottomNav must not reference drawerMode or intel-mobile',
    );
    assert.match(src, /<Link\b/, 'MobileBottomNav must render Link components');
  });

  it('Layout has navigation link to trends', () => {
    const layoutPath = join(SRC, 'components', 'Layout.jsx');
    const src = readFileSync(layoutPath, 'utf8');
    assert.ok(
      src.includes('to="/trends"') || src.includes("to='/trends'"),
      'Link to /trends must exist in Layout',
    );
  });

  it('routes use Layout as parent wrapper', () => {
    const src = readFileSync(join(SRC, 'main.jsx'), 'utf8');
    assert.ok(src.includes('Layout'), 'main.jsx must reference Layout component');
    // The Layout route should wrap child routes
    assert.ok(
      src.includes('element={<Layout') || src.includes('element={ <Layout'),
      'Layout must be used as a route element wrapping children',
    );
  });

  it('Layout — not App.jsx — owns the data pipeline kick (so direct-nav to /intel, /trends, /region works)', () => {
    const layout = readFileSync(join(SRC, 'components', 'Layout.jsx'), 'utf8');
    const app = readFileSync(join(SRC, 'App.jsx'), 'utf8');
    assert.match(
      layout,
      /startAutoRefresh\s*\(/,
      'Layout must call startAutoRefresh so every Layout-wrapped route gets the data pipeline',
    );
    assert.equal(
      /startAutoRefresh\s*\(/.test(app),
      false,
      'App.jsx must not call startAutoRefresh — Layout owns that now (else /intel, /trends direct-nav stay loading)',
    );
  });

  it('navigation uses react-router-dom Link (no full page reloads)', () => {
    const layoutPath = join(SRC, 'components', 'Layout.jsx');
    const src = readFileSync(layoutPath, 'utf8');
    // Must import from react-router-dom
    assert.ok(src.includes('react-router-dom'), 'Must import from react-router-dom');
    // Must NOT use <a href="..."> for internal navigation
    const anchorMatches = src.match(/<a\s+href=["']\//g);
    assert.ok(!anchorMatches, 'Must not use <a href="/..."> for internal routes — use Link instead');
  });

  it('i18n keys exist for navigation items', () => {
    const en = JSON.parse(readFileSync(join(SRC, 'i18n', 'locales', 'en.json'), 'utf8'));
    assert.ok(en.nav, 'nav section must exist in i18n');
    for (const key of ['map', 'admin', 'entities', 'trends', 'intel', 'region']) {
      assert.ok(en.nav[key], `nav.${key} key must exist`);
    }
  });
});
