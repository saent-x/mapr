import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

// Truthfulness: mock data has been removed from the application. When data
// can't be fetched, the UI shows an honest 'unavailable' state with
// DataErrorBanner. These tests pin that contract so a future regression
// reintroducing mock fallbacks fails CI loudly.
describe('frontend data provenance labels', () => {
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const header = readFileSync(join(ROOT, 'src/components/Header.jsx'), 'utf8');
  const layout = readFileSync(join(ROOT, 'src/components/Layout.jsx'), 'utf8');
  const panel = readFileSync(join(ROOT, 'src/components/NewsPanel.jsx'), 'utf8');
  const intel = readFileSync(join(ROOT, 'src/pages/IntelPage.jsx'), 'utf8');
  const newsStore = readFileSync(join(ROOT, 'src/stores/newsStore.ts'), 'utf8');

  it('feedSourceLabel only knows live/loading/offline — never demo/mock', () => {
    assert.match(panel, /function feedSourceLabel\(dataSource\)/);
    assert.match(panel, /if \(dataSource === 'loading'\) return 'LOADING'/);
    assert.match(panel, /if \(dataSource === 'live'\) return 'LIVE'/);
    assert.match(panel, /return 'OFFLINE'/);
    assert.doesNotMatch(panel, /'DEMO DATA'/);
    assert.match(panel, /FEED · \{sourceLabel\}/);
  });

  it('passes data provenance into all NewsPanel render paths', () => {
    assert.match(app, /<NewsPanel[\s\S]*?dataSource=\{dataSource\}/);
    assert.match(intel, /<NewsPanel[\s\S]*?dataSource=\{dataSource\}/);
  });

  it('shell reflects unavailable state honestly (offline, not nominal)', () => {
    assert.match(layout, /const dataSource = useNewsStore\(\(s\) => s\.dataSource\)/);
    assert.match(layout, /feedStatusLabel = dataSource === 'live'/);
    assert.match(layout, /FEED · <b>\{feedStatusLabel\}<\/b>/);
    assert.match(layout, /dataSource === 'unavailable'[\s\S]*?'OFFLINE'/);
    assert.match(header, /const dataSource = useNewsStore\(\(s\) => s\.dataSource\)/);
    assert.match(header, /const isUnavailable = dataSource === 'unavailable'/);
    assert.match(header, /const opsLabel = isUnavailable[\s\S]*?'OFFLINE'/);
    assert.match(header, /OPS · \$\{opsLabel\}/);
  });

  it('shows DataErrorBanner when data is unavailable', () => {
    assert.match(app, /dataError && <DataErrorBanner/);
    assert.match(app, /!dataError && dataSource === 'unavailable' && <DataErrorBanner/);
  });

  it('newsStore must NOT introduce a mock dataSource', () => {
    assert.doesNotMatch(newsStore, /dataSource:\s*'mock'/);
    assert.match(newsStore, /dataSource:\s*'unavailable'/);
  });
});
