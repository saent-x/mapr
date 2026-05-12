import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

describe('UI polish hardening', () => {
  it('keeps semantic visual colors centralized and theme-aware', () => {
    const visualSystem = readFileSync(join(ROOT, 'src/utils/visualSystem.js'), 'utf8');
    const severityMeta = readFileSync(join(ROOT, 'src/utils/severityMeta.js'), 'utf8');
    const coverageMeta = readFileSync(join(ROOT, 'src/utils/coverageMeta.js'), 'utf8');
    const credibilityMeta = readFileSync(join(ROOT, 'src/utils/credibilityMeta.js'), 'utf8');
    const anomalyUtils = readFileSync(join(ROOT, 'src/utils/anomalyUtils.js'), 'utf8');

    assert.match(visualSystem, /VISUAL_COLORS/);
    assert.match(visualSystem, /getSeverityVisual/);
    assert.match(visualSystem, /getCoverageVisual/);
    assert.match(visualSystem, /getReliabilityVisual/);
    assert.match(visualSystem, /getAnomalyVisual/);
    assert.match(visualSystem, /getGeopoliticalLegend/);
    assert.doesNotMatch(severityMeta, /#[0-9a-fA-F]{6}|rgba?\(/);
    assert.doesNotMatch(coverageMeta, /#[0-9a-fA-F]{6}|rgba?\(/);
    assert.doesNotMatch(credibilityMeta, /#[0-9a-fA-F]{6}|rgba?\(/);
    assert.doesNotMatch(anomalyUtils, /#[0-9a-fA-F]{6}/);
  });

  it('uses the shared MAPR mark plus lucide icons for shared sidebar navigation', () => {
    const layout = readFileSync(join(ROOT, 'src/components/Layout.jsx'), 'utf8');
    assert.match(layout, /import BrandMark from '\.\/BrandMark'/);
    assert.match(layout, /Network,\s*TrendingUp,\s*MapPin/);
    assert.match(layout, /layout-mapr-nav-icon/);
    assert.doesNotMatch(layout, /to="\/billing"/);
    assert.doesNotMatch(layout, /<svg width="18" height="18"/);
    assert.doesNotMatch(layout, /const Ico = \{/);
  });

  it('health page inherits app theme tokens instead of dark neon colors', () => {
    const health = readFileSync(join(ROOT, 'src/pages/HealthPage.jsx'), 'utf8');
    assert.match(health, /var\(--bg-0\)/);
    assert.match(health, /var\(--ink-0\)/);
    assert.match(health, /var\(--accent\)/);
    assert.doesNotMatch(health, /#00d4ff|#00e5a0|#ff3b5c|#ff8a3d|#060a12|#e2e8f0/);
  });

  it('uses dynamic viewport units for full-height shells', () => {
    assert.match(css, /\.layout\s*\{[\s\S]*?min-height:\s*100dvh/);
    assert.match(css, /\.layout\s*\{[\s\S]*?height:\s*100dvh/);
    assert.match(css, /\.event-detail-page\s*\{[\s\S]*?min-height:\s*100dvh/);
  });

  it('applies typography polish globally', () => {
    assert.match(css, /font-variant-numeric:\s*tabular-nums/);
    assert.match(css, /text-wrap:\s*pretty/);
    assert.match(css, /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{[\s\S]*?text-wrap:\s*balance/);
  });

  it('keeps close controls touch-safe and tactile', () => {
    assert.match(css, /\.shortcut-help-close\s*\{[\s\S]*?width:\s*40px[\s\S]*?height:\s*40px/);
    assert.match(css, /\.onboard-close\s*\{[\s\S]*?width:\s*40px[\s\S]*?height:\s*40px/);
    assert.match(css, /\.shortcut-help-close:active\s*\{[\s\S]*?transform:\s*scale\(0\.96\)/);
    assert.match(css, /\.onboard-close:active\s*\{[\s\S]*?transform:\s*scale\(0\.96\)/);
  });

  it('mobile menu button uses the animated two-line glyph', () => {
    const header = readFileSync(join(ROOT, 'src/components/Header.jsx'), 'utf8');
    assert.match(header, /header-menu-glyph/);
    assert.doesNotMatch(header, /menuOpen \? <X size=\{18\}/);
    assert.match(css, /\.header-menu-glyph\[data-open\] span:first-child\s*\{[\s\S]*?transform:\s*rotate\(45deg\)/);
    assert.match(css, /@keyframes mobileMenuIn/);
  });

  it('news thumbnails sanitize RSS HTML image wrappers before rendering', () => {
    const panel = readFileSync(join(ROOT, 'src/components/NewsPanel.jsx'), 'utf8');
    assert.match(panel, /function safeImageSrc/);
    assert.match(panel, /raw\.match\(\/\\bsrc\\s\*=\\s\*\["'\]\(\[\^"'\]\+\)\["'\]\/i\)/);
    assert.match(panel, /url\.protocol === 'https:' \|\| url\.protocol === 'http:'/);
    assert.match(panel, /const src = safeImageSrc\(story\.socialimage \|\| story\.image\)/);
  });

  it('news summaries render normalized article text instead of raw RSS HTML', () => {
    const panel = readFileSync(join(ROOT, 'src/components/NewsPanel.jsx'), 'utf8');
    const eventDetail = readFileSync(join(ROOT, 'src/pages/EventDetailPage.jsx'), 'utf8');
    const regionDetail = readFileSync(join(ROOT, 'src/pages/RegionDetailPage.jsx'), 'utf8');
    assert.match(panel, /normalizeArticleText\(story\.summary\)/);
    assert.match(panel, /getArticleTextPreview\(story\.summary, 180\)\.text/);
    assert.match(eventDetail, /normalizeArticleText\(event\.summary\)/);
    assert.match(regionDetail, /getArticleTextPreview\(story\.summary, 180\)\.text/);
  });

  it('map news rows expand deterministically and keep row text structured', () => {
    const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
    const panel = readFileSync(join(ROOT, 'src/components/NewsPanel.jsx'), 'utf8');
    assert.doesNotMatch(app, /<NewsPanel\s+key=\{panelRegion/, 'Region selection should not remount the feed and discard row expansion');
    assert.match(panel, /export function ArticleDetail[\s\S]*?useTranslation\(\)/, 'Expanded article detail must initialize translations before using t()');
    assert.match(panel, /collapsedSelectedStoryRef/);
    assert.match(panel, /const expanded = expandedId === story\.id/);
    assert.match(panel, /if \(expanded\) \{[\s\S]*?setExpandedId\(null\)/);
    assert.match(panel, /setExpandedId\(story\.id\)/);
    assert.match(panel, /encodeURIComponent\(story\.id\)/);
    assert.match(css, /\.news-panel\s*\{[\s\S]*?width:\s*342px/);
    assert.match(css, /\.news-title\s*\{[\s\S]*?-webkit-line-clamp:\s*2/);
    assert.match(css, /\.news-src\s*\{[\s\S]*?text-overflow:\s*ellipsis/);
  });

  it('map feed header keeps briefing action compact', () => {
    const panel = readFileSync(join(ROOT, 'src/components/NewsPanel.jsx'), 'utf8');
    assert.match(panel, /news-panel-briefing-btn/);
    assert.doesNotMatch(panel, /style=\{\{\s*marginLeft:\s*8,\s*padding:\s*'2px 8px'/);
    assert.match(css, /\.news-panel-briefing-btn\s*\{/);
    assert.match(css, /\.news-panel-count\s*\{[\s\S]*?white-space:\s*nowrap/);
  });

  it('uses the shared MAPR mark for primary brand and map navigation', () => {
    const brand = readFileSync(join(ROOT, 'src/components/BrandMark.jsx'), 'utf8');
    const header = readFileSync(join(ROOT, 'src/components/Header.jsx'), 'utf8');
    const layout = readFileSync(join(ROOT, 'src/components/Layout.jsx'), 'utf8');
    const mobileNav = readFileSync(join(ROOT, 'src/components/MobileBottomNav.jsx'), 'utf8');
    const login = readFileSync(join(ROOT, 'src/pages/LoginPage.jsx'), 'utf8');
    assert.match(brand, /function BrandMark/);
    assert.match(header, /import BrandMark from '\.\/BrandMark'/);
    assert.match(layout, /layout-mapr-nav-icon/);
    assert.match(mobileNav, /mobile-nav-brand-mark/);
    assert.match(login, /login-brand-mark/);
  });

  it('map screen starts cleaner with secondary panels collapsed and chrome lanes spaced out', () => {
    const store = readFileSync(join(ROOT, 'src/stores/uiStore.ts'), 'utf8');
    assert.match(store, /mapr:rightRailCollapsed:v2/);
    assert.match(store, /anomaly:\s*true,\s*watchlist:\s*true,\s*narrative:\s*true,\s*liveFeed:\s*false/);
    assert.match(css, /\.side-panels\s*\{[\s\S]*?top:\s*44px/);
    assert.match(css, /\.news-panel\s*\{[\s\S]*?top:\s*44px/);
    assert.match(css, /\.map-drill-menu\s*\{[\s\S]*?right:\s*320px[\s\S]*?flex-wrap:\s*nowrap/);
  });

  it('keeps the live map intel ticker visible', () => {
    const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
    assert.match(app, /className=\{`intel-ticker/, 'App should render the moving intel ticker');
    assert.match(css, /\.intel-ticker\s*\{[\s\S]*?display:\s*flex/, 'Ticker should be visible on desktop map');
    assert.match(css, /@keyframes ticker-scroll/, 'Ticker should keep moving via CSS animation');
  });
});
