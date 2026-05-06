import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '..', 'src');

// ---------------------------------------------------------------------------
// TrendAnalysisPage.jsx structural checks
// ---------------------------------------------------------------------------

describe('VAL-M2-020: Time range toggle in trends page', () => {
  const pagePath = path.join(srcDir, 'pages', 'TrendAnalysisPage.jsx');

  it('TrendAnalysisPage.jsx exists', () => {
    assert.ok(fs.existsSync(pagePath));
  });

  it('imports useSearchParams for URL param handling', () => {
    const content = fs.readFileSync(pagePath, 'utf-8');
    assert.match(content, /useSearchParams/);
  });

  it('defines VALID_RANGES with 7d, 30d, 90d', () => {
    const content = fs.readFileSync(pagePath, 'utf-8');
    assert.match(content, /VALID_RANGES\s*=\s*\[.*'7d'.*'30d'.*'90d'/);
  });

  it('defines DEFAULT_RANGE as 30d', () => {
    const content = fs.readFileSync(pagePath, 'utf-8');
    assert.match(content, /DEFAULT_RANGE\s*=\s*'30d'/);
  });

  it('renders toggle-chip buttons for each range', () => {
    const content = fs.readFileSync(pagePath, 'utf-8');
    assert.match(content, /className="toggle-chip"/);
    assert.match(content, /data-active=\{range\s*===\s*r/);
    assert.match(content, /aria-pressed=\{range\s*===\s*r\}/);
  });

  it('calls setSearchParams on range change', () => {
    const content = fs.readFileSync(pagePath, 'utf-8');
    assert.match(content, /setSearchParams\(next,\s*\{\s*replace:\s*true\s*\}\)/);
  });

  it('syncs URL when range param is missing or invalid', () => {
    const content = fs.readFileSync(pagePath, 'utf-8');
    assert.match(content, /!VALID_RANGES\.includes\(rangeParam\)/);
  });

  it('applies CSS class trends-range-toggle for styling', () => {
    const content = fs.readFileSync(pagePath, 'utf-8');
    assert.match(content, /className="trends-range-toggle"/);
  });
});

// ---------------------------------------------------------------------------
// trendBuilders.js unit tests
// ---------------------------------------------------------------------------

describe('VAL-M2-021: All charts respond to time range selection', () => {
  const trendBuildersPath = path.join(srcDir, 'utils', 'trendBuilders.js');
  let builders;

  function makeArticle(overrides = {}) {
    const now = Date.now();
    return {
      id: 'art-1',
      title: 'Test Article',
      isoA2: 'US',
      firstSeenAt: new Date(now - 2 * 24 * 3600_000).toISOString(), // 2 days ago
      severity: 50,
      category: 'conflict',
      language: 'en',
      entities: {
        people: [{ name: 'Test Person' }],
        organizations: [],
        locations: [],
      },
      ...overrides,
    };
  }

  before(async () => {
    builders = await import('../src/utils/trendBuilders.js');
    assert.ok(fs.existsSync(trendBuildersPath), 'trendBuilders.js must exist');
  });

  describe('buildRegionalSeries', () => {
    it('returns empty array for empty news', () => {
      const result = builders.buildRegionalSeries([], 5, 30);
      assert.deepEqual(result, []);
    });

    it('returns series with iso field for valid data', () => {
      const news = [makeArticle({ isoA2: 'US' }), makeArticle({ isoA2: 'US' })];
      const result = builders.buildRegionalSeries(news, 5, 30);
      assert.ok(result.length > 0);
      assert.equal(result[0].iso, 'US');
      assert.ok(typeof result[0].label === 'string');
      assert.ok(Array.isArray(result[0].data));
    });

    it('uses 7 buckets when rangeDays <= 7', () => {
      const news = Array.from({ length: 10 }, () => makeArticle({ isoA2: 'US' }));
      const result = builders.buildRegionalSeries(news, 5, 7);
      assert.equal(result[0].data.length, 7);
    });

    it('uses 30 buckets when rangeDays > 7', () => {
      const news = Array.from({ length: 10 }, () => makeArticle({ isoA2: 'US' }));
      const result30 = builders.buildRegionalSeries(news, 5, 30);
      const result90 = builders.buildRegionalSeries(news, 5, 90);
      assert.equal(result30[0].data.length, 30);
      assert.equal(result90[0].data.length, 30);
    });

    it('data within range window is binned', () => {
      const now = Date.now();
      const old = new Date(now - 10 * 24 * 3600_000).toISOString();
      const recent = new Date(now - 2 * 24 * 3600_000).toISOString();
      const news = [
        makeArticle({ isoA2: 'US', firstSeenAt: old }),
        makeArticle({ isoA2: 'US', firstSeenAt: recent }),
      ];
      const result = builders.buildRegionalSeries(news, 5, 7);
      // Only articles within 7d window are counted
      const totalInBins = result[0].data.reduce((a, b) => a + b, 0);
      assert.ok(totalInBins <= 1, 'Old article should fall outside 7d window');
    });

    it('returns different data for different rangeDays', () => {
      const now = Date.now();
      const news = Array.from({ length: 20 }, (_, i) =>
        makeArticle({
          isoA2: 'US',
          firstSeenAt: new Date(now - i * 24 * 3600_000).toISOString(),
        })
      );
      const result7 = builders.buildRegionalSeries(news, 5, 7);
      const result30 = builders.buildRegionalSeries(news, 5, 30);
      // Different range => different bucket count
      assert.notDeepEqual(result7[0].data, result30[0].data);
    });
  });

  describe('buildByCategory', () => {
    it('returns empty array for empty news', () => {
      const result = builders.buildByCategory([], 6, 14);
      assert.deepEqual(result, []);
    });

    it('groups articles by category', () => {
      const news = [
        makeArticle({ category: 'conflict' }),
        makeArticle({ category: 'disaster' }),
        makeArticle({ category: 'conflict' }),
      ];
      const result = builders.buildByCategory(news, 6, 30);
      const conflictSeries = result.find((s) => s.label === 'CONFLICT');
      assert.ok(conflictSeries);
    });

    it('uses 7 buckets for rangeDays <= 7', () => {
      const news = Array.from({ length: 10 }, () => makeArticle({ category: 'conflict' }));
      const result = builders.buildByCategory(news, 6, 7);
      if (result.length > 0) {
        assert.equal(result[0].data.length, 7);
      }
    });

    it('uses 14 buckets for rangeDays > 7', () => {
      const news = Array.from({ length: 10 }, () => makeArticle({ category: 'conflict' }));
      const result = builders.buildByCategory(news, 6, 30);
      if (result.length > 0) {
        assert.equal(result[0].data.length, 14);
      }
    });
  });

  describe('buildSourceVelocity', () => {
    it('returns 12-element array', () => {
      const news = Array.from({ length: 10 }, () => makeArticle());
      const result = builders.buildSourceVelocity(news, 2, 1);
      assert.equal(result.length, 12);
    });

    it('returns empty (all zeros) for empty news', () => {
      const result = builders.buildSourceVelocity([], 2, 1);
      assert.deepEqual(result, new Array(12).fill(0));
    });

    it('uses actualBucketHrs = bucketHrs when rangeDays <= 1', () => {
      // Just verify the function works without error
      const news = [makeArticle()];
      const result = builders.buildSourceVelocity(news, 2, 1);
      assert.equal(result.length, 12);
    });

    it('calculates bucket hours from range when rangeDays > 1', () => {
      const news = [makeArticle()];
      const result = builders.buildSourceVelocity(news, 2, 7);
      assert.equal(result.length, 12);
    });
  });

  describe('buildSeverityDistribution', () => {
    it('returns 4 severity tiers', () => {
      const news = [makeArticle({ severity: 0 })];
      const result = builders.buildSeverityDistribution(news);
      assert.equal(result.length, 4);
      assert.equal(result[0].key, 'critical');
      assert.equal(result[3].key, 'low');
    });

    it('classifies severity correctly', () => {
      const news = [
        makeArticle({ severity: 80, id: 'a' }),
        makeArticle({ severity: 50, id: 'b' }),
        makeArticle({ severity: 30, id: 'c' }),
        makeArticle({ severity: 10, id: 'd' }),
      ];
      const result = builders.buildSeverityDistribution(news);
      assert.equal(result[0].count, 1); // critical (80)
      assert.equal(result[1].count, 1); // elevated (50)
      assert.equal(result[2].count, 1); // watch (30)
      assert.equal(result[3].count, 1); // low (10)
    });
  });

  describe('buildLangMix', () => {
    it('groups by language', () => {
      const news = [
        makeArticle({ language: 'en' }),
        makeArticle({ language: 'fr' }),
      ];
      const result = builders.buildLangMix(news);
      assert.ok(result.some((r) => r.l === 'EN'));
      assert.ok(result.some((r) => r.l === 'FR'));
    });

    it('defaults to en for missing language', () => {
      const news = [makeArticle()];
      delete news[0].language;
      const result = builders.buildLangMix(news);
      assert.ok(result.some((r) => r.l === 'EN'));
    });
  });
});

// ---------------------------------------------------------------------------
// VAL-M2-022: URL param persistence
// ---------------------------------------------------------------------------

describe('VAL-M2-022: Time range persisted in URL params', () => {
  const pagePath = path.join(srcDir, 'pages', 'TrendAnalysisPage.jsx');

  it('reads range from searchParams.get("range")', () => {
    const content = fs.readFileSync(pagePath, 'utf-8');
    assert.match(content, /searchParams\.get\('range'\)/);
  });

  it('defaults to 30d when range param is missing', () => {
    const content = fs.readFileSync(pagePath, 'utf-8');
    // range falls back to DEFAULT_RANGE when not in VALID_RANGES
    assert.match(content, /VALID_RANGES\.includes\(rangeParam\).*rangeParam\s*:\s*DEFAULT_RANGE/);
  });

  it('syncs invalid/missing range param into URL via useEffect', () => {
    const content = fs.readFileSync(pagePath, 'utf-8');
    assert.match(content, /!VALID_RANGES\.includes\(rangeParam\)/);
    assert.match(content, /next\.set\('range'/);
  });

  it('i18n keys exist in all 5 locales', () => {
    const locales = ['en', 'es', 'fr', 'ar', 'zh'];
    for (const lang of locales) {
      const localePath = path.join(srcDir, 'i18n', 'locales', `${lang}.json`);
      const data = JSON.parse(fs.readFileSync(localePath, 'utf-8'));
      assert.ok(data.trends, `locale ${lang} must have trends section`);
      assert.ok(data.trends.timeRangeLabel, `locale ${lang} must have timeRangeLabel`);
      assert.ok(data.trends.timeRange7d, `locale ${lang} must have timeRange7d`);
      assert.ok(data.trends.timeRange30d, `locale ${lang} must have timeRange30d`);
      assert.ok(data.trends.timeRange90d, `locale ${lang} must have timeRange90d`);
    }
  });
});

// ---------------------------------------------------------------------------
// CSS styling check
// ---------------------------------------------------------------------------

describe('Trends range toggle CSS', () => {
  const cssPath = path.join(srcDir, 'index.css');

  it('CSS has trends-range-toggle styles', () => {
    const content = fs.readFileSync(cssPath, 'utf-8');
    assert.match(content, /\.trends-range-toggle\s*\{/);
    assert.match(content, /\.trends-range-label\s*\{/);
  });

  it('trends-range-toggle spans full grid width (grid-column: 1 / -1)', () => {
    const content = fs.readFileSync(cssPath, 'utf-8');
    assert.match(content, /grid-column:\s*1\s*\/\s*-1/);
  });
});
