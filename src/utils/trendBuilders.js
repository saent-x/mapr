/**
 * trendBuilders.js — chart data builder functions for TrendAnalysisPage.
 * Extracted for testability.
 */
import { isoToCountry } from './geocoder.js';

const SERIES_COLORS = ['var(--amber)', 'var(--cyan)', 'var(--sev-red)', 'var(--sev-green)', 'var(--sev-amber)'];

/**
 * Builds line-chart series for the top N regions by article count.
 * @param {object[]} news - canonicalized articles
 * @param {number} [topN=5]
 * @param {number} [rangeDays=30]
 * @returns {{ label: string, iso: string, data: number[], color: string }[]}
 */
export function buildRegionalSeries(news, topN = 5, rangeDays = 30) {
  const byIso = new Map();
  for (const s of news) {
    if (!s.isoA2) continue;
    if (!byIso.has(s.isoA2)) byIso.set(s.isoA2, []);
    byIso.get(s.isoA2).push(s);
  }
  const rankedIsos = [...byIso.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, topN)
    .map(([iso]) => iso);

  const BUCKETS = rangeDays <= 7 ? 7 : rangeDays <= 30 ? 30 : 30;
  const HOUR_MS = 3600 * 1000;
  const bucketSpanDays = rangeDays / BUCKETS;
  const WINDOW = rangeDays * 24 * HOUR_MS;
  const now = Date.now();

  return rankedIsos.map((iso, idx) => {
    const list = byIso.get(iso) || [];
    const bins = new Array(BUCKETS).fill(0);
    for (const art of list) {
      const ts = art.firstSeenAt ? new Date(art.firstSeenAt).getTime() : null;
      if (!ts) continue;
      const offset = now - ts;
      if (offset < 0 || offset > WINDOW) continue;
      const bucket = BUCKETS - 1 - Math.floor(offset / (bucketSpanDays * 24 * HOUR_MS));
      if (bucket >= 0 && bucket < BUCKETS) bins[bucket] += 1;
    }
    return {
      label: isoToCountry(iso) || iso,
      iso,
      data: bins,
      color: SERIES_COLORS[idx % SERIES_COLORS.length],
    };
  });
}

/**
 * Builds horizon-chart series grouped by article category.
 * @param {object[]} news - canonicalized articles
 * @param {number} [topN=6]
 * @param {number} [rangeDays=14]
 * @returns {{ label: string, data: number[], color: string }[]}
 */
export function buildByCategory(news, topN = 6, rangeDays = 14) {
  const byCat = new Map();
  for (const s of news) {
    const cat = (s.category || 'other').toLowerCase();
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(s);
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, topN);
  const BUCKETS = rangeDays <= 7 ? 7 : 14;
  const now = Date.now();
  const DAY = 24 * 3600 * 1000;
  const bucketSpanDays = rangeDays / BUCKETS;
  return cats.map(([cat, list], idx) => {
    const bins = new Array(BUCKETS).fill(0);
    for (const art of list) {
      const ts = art.firstSeenAt ? new Date(art.firstSeenAt).getTime() : null;
      if (!ts) continue;
      const offset = now - ts;
      if (offset < 0 || offset > rangeDays * DAY) continue;
      const bucket = BUCKETS - 1 - Math.floor(offset / (bucketSpanDays * DAY));
      if (bucket >= 0 && bucket < BUCKETS) bins[bucket] += 1;
    }
    return { label: cat.toUpperCase(), data: bins, color: SERIES_COLORS[idx % SERIES_COLORS.length] };
  });
}

/**
 * Builds velocity-chart data as an array of counts per bucket.
 * @param {object[]} news - canonicalized articles
 * @param {number} [bucketHrs=2]
 * @param {number} [rangeDays=1]
 * @returns {number[]}
 */
export function buildSourceVelocity(news, bucketHrs = 2, rangeDays = 1) {
  const BUCKETS = 12;
  const now = Date.now();
  const span = rangeDays * 24 * 3600_000;
  const actualBucketHrs = rangeDays <= 1 ? bucketHrs : (rangeDays * 24) / BUCKETS;
  const bins = new Array(BUCKETS).fill(0);
  for (const s of news) {
    const ts = s.firstSeenAt ? new Date(s.firstSeenAt).getTime() : null;
    if (!ts) continue;
    const offset = now - ts;
    if (offset < 0 || offset > span) continue;
    const idx = BUCKETS - 1 - Math.floor(offset / (actualBucketHrs * 3600_000));
    if (idx >= 0 && idx < BUCKETS) bins[idx] += 1;
  }
  return bins;
}

/**
 * Builds severity distribution counts for donut chart.
 * @param {object[]} news - canonicalized articles
 * @returns {{ key: string, label: string, min: number, color: string, count: number, pct: number }[]}
 */
export function buildSeverityDistribution(news) {
  const tiers = [
    { key: 'critical', label: 'CRITICAL', min: 70, color: 'var(--sev-red)' },
    { key: 'elevated', label: 'ELEVATED', min: 40, color: 'var(--elevated)' },
    { key: 'watch', label: 'WATCH', min: 20, color: 'var(--sev-amber)' },
    { key: 'low', label: 'LOW', min: 0, color: 'var(--sev-green)' },
  ];
  const counts = { critical: 0, elevated: 0, watch: 0, low: 0 };
  for (const s of news) {
    const sev = s.severity ?? 0;
    if (sev >= 70) counts.critical++;
    else if (sev >= 40) counts.elevated++;
    else if (sev >= 20) counts.watch++;
    else counts.low++;
  }
  const total = news.length || 1;
  return tiers.map((t) => ({ ...t, count: counts[t.key], pct: Math.round((counts[t.key] / total) * 100) }));
}

/**
 * Builds language mix distribution for bar chart.
 * @param {object[]} news - canonicalized articles
 * @returns {{ l: string, pct: number }[]}
 */
export function buildLangMix(news) {
  const byLang = {};
  for (const s of news) {
    const l = (s.language || 'en').toLowerCase();
    byLang[l] = (byLang[l] || 0) + 1;
  }
  const total = Object.values(byLang).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(byLang)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([l, c]) => ({ l: l.toUpperCase(), pct: Math.round((c / total) * 100) }));
}
