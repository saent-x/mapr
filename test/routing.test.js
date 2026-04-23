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
    // Admin sidebar link restored — admin page still gated by password internally
    assert.ok(src.includes('to="/admin"') || src.includes("to='/admin'"), 'Link to /admin must exist in sidebar');
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

  it('intel + filters routes are configured in main.jsx', () => {
    const src = readFileSync(join(SRC, 'main.jsx'), 'utf8');
    assert.ok(
      src.includes('path="/intel"') || src.includes("path='/intel'"),
      'intel route /intel must exist',
    );
    assert.ok(src.includes('IntelPage'), 'main.jsx must reference IntelPage');
    assert.ok(
      src.includes('path="/filters"') || src.includes("path='/filters'"),
      'filters route /filters must exist',
    );
    assert.ok(src.includes('FiltersPage'), 'main.jsx must reference FiltersPage');
  });

  it('IntelPage + FiltersPage exist with default exports', () => {
    const intelPath = join(SRC, 'pages', 'IntelPage.jsx');
    const filtersPath = join(SRC, 'pages', 'FiltersPage.jsx');
    assert.ok(existsSync(intelPath), 'IntelPage.jsx must exist in pages/');
    assert.ok(existsSync(filtersPath), 'FiltersPage.jsx must exist in pages/');
    const intel = readFileSync(intelPath, 'utf8');
    const filters = readFileSync(filtersPath, 'utf8');
    assert.ok(intel.includes('export default'), 'IntelPage must export default');
    assert.ok(filters.includes('export default'), 'FiltersPage must export default');
    assert.ok(intel.includes('mobile-tab-page'), 'IntelPage must render mobile-tab-page container');
    assert.ok(filters.includes('mobile-tab-page'), 'FiltersPage must render mobile-tab-page container');
  });

  it('MobileBottomNav uses Link (not sheet toggles) for Intel + Filters', () => {
    const src = readFileSync(join(SRC, 'components', 'MobileBottomNav.jsx'), 'utf8');
    assert.ok(
      src.includes('to="/intel"') || src.includes("to='/intel'"),
      'MobileBottomNav must navigate to /intel',
    );
    assert.ok(
      src.includes('to="/filters"') || src.includes("to='/filters'"),
      'MobileBottomNav must navigate to /filters',
    );
    assert.equal(
      /drawerMode|setDrawerMode|intel-mobile/.test(src),
      false,
      'MobileBottomNav must not reference drawerMode or intel-mobile',
    );
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
    assert.ok(en.nav.map, 'nav.map key must exist');
    assert.ok(en.nav.admin, 'nav.admin key must exist');
    assert.ok(en.nav.entities, 'nav.entities key must exist');
  });
});
