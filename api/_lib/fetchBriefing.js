import { ALL_RSS_FEEDS } from '../../src/services/rssService.js';
import { parseFeedItems } from '../../server/rssParser.js';
import { geocodeArticleAll, countryToIso } from '../../src/utils/geocoder.js';
import { deriveSeverity, deriveCategory, deduplicateArticles } from '../../src/utils/articleUtils.js';
import { classifySourceType } from '../../src/utils/sourceMetadata.js';
import { detectLanguage } from '../../src/utils/languageUtils.js';
import { canonicalizeArticles, calculateCoverageMetrics } from '../../src/utils/newsPipeline.js';
import { buildCoverageDiagnostics } from '../../src/utils/coverageDiagnostics.js';
import { encodeBase64 } from '../../src/utils/base64.js';

const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const FEED_TIMEOUT_MS = 5000;

const COVERAGE_THEME = [
  'crisis', 'disaster', 'conflict', 'earthquake', 'flood', 'storm', 'wildfire',
  'drought', 'famine', 'protest', 'attack', 'explosion', 'outbreak', 'aid',
  'displacement', 'blackout', 'landslide', 'evacuation', 'ceasefire'
].join(' OR ');

// ── Helpers ──────────────────────────────────────────────────

function parseGdeltDate(seendate) {
  if (!seendate) return new Date().toISOString();
  const match = seendate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return new Date().toISOString();
  const [, year, month, day, hour, min, sec] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).toISOString();
}

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    headers: {
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
      'user-agent': 'Mapr/1.0 (+serverless ingest)'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

// ── RSS ──────────────────────────────────────────────────────

function normalizeRssArticle(item, feed, index) {
  if (!item?.title) return [];

  const geos = geocodeArticleAll(item.title, feed.country, item.summary);
  if (geos.length === 0) return [];

  const date = new Date(item.publishedAt || Date.now());
  const publishedAt = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  const baseId = `rss-server-${feed.id}-${index}`;

  return geos.map((geo, geoIdx) => ({
    id: geos.length > 1 ? `${baseId}-${geoIdx}` : baseId,
    title: item.title,
    summary: item.summary || item.title,
    url: item.link || '',
    severity: deriveSeverity(item.title, item.summary),
    publishedAt,
    region: geo.region,
    isoA2: countryToIso(geo.region) || 'XX',
    locality: geo.locality,
    category: deriveCategory(item.title),
    coordinates: [geo.lat, geo.lng],
    source: feed.name,
    sourceCountry: feed.country || null,
    sourceType: classifySourceType({
      source: feed.name,
      sourceCountry: feed.country,
      sourceType: feed.sourceType
    }),
    language: detectLanguage(`${item.title} ${item.summary || ''}`, feed.language || null),
    geocodePrecision: geo.precision,
    geocodeMatchedOn: geo.matchedOn,
    socialimage: item.mediaUrl || null,
    isLive: true
  }));
}

async function fetchSingleFeed(feed) {
  try {
    const xmlText = await fetchText(feed.url);
    const items = parseFeedItems(xmlText);
    return items.flatMap((item, i) => normalizeRssArticle(item, feed, i));
  } catch {
    return [];
  }
}

async function fetchAllRss() {
  const results = await Promise.allSettled(
    ALL_RSS_FEEDS.map((feed) => fetchSingleFeed(feed))
  );

  const articles = [];
  let healthyFeeds = 0;
  let failedFeeds = 0;
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.length > 0) {
      articles.push(...result.value);
      healthyFeeds++;
    } else {
      failedFeeds++;
    }
  }
  return { articles, healthyFeeds, failedFeeds, totalFeeds: ALL_RSS_FEEDS.length };
}

// ── GDELT ────────────────────────────────────────────────────

async function fetchGdelt(maxRecords = 250) {
  try {
    const params = new URLSearchParams({
      query: `(${COVERAGE_THEME})`,
      mode: 'artlist',
      format: 'json',
      timespan: '24h',
      maxrecords: String(maxRecords),
      sort: 'DateDesc'
    });

    const response = await fetch(`${GDELT_DOC_URL}?${params}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return [];

    const data = await response.json();
    const raw = data?.articles || [];

    const normalized = [];
    const seenUrls = new Set();

    for (const article of raw) {
      const titleKey = (article.title || '').toLowerCase().trim();
      if (!titleKey) continue;
      const urlKey = (article.url || '').toLowerCase().trim();
      if (urlKey && seenUrls.has(urlKey)) continue;
      if (urlKey) seenUrls.add(urlKey);

      const geos = geocodeArticleAll(article.title, article.sourcecountry, article.title);
      if (geos.length === 0) continue;

      const baseId = `gdelt-${encodeBase64(article.url || titleKey).slice(0, 16)}-${normalized.length}`;
      for (let gi = 0; gi < geos.length; gi++) {
        const geo = geos[gi];
        normalized.push({
          id: geos.length > 1 ? `${baseId}-${gi}` : baseId,
          title: article.title,
          summary: article.title,
          url: article.url,
          severity: deriveSeverity(article.title),
          publishedAt: parseGdeltDate(article.seendate),
          region: geo.region,
          isoA2: countryToIso(geo.region) || 'XX',
          locality: geo.locality,
          category: deriveCategory(article.title),
          coordinates: [geo.lat, geo.lng],
          source: article.domain || article.sourcecountry || 'Unknown',
          sourceCountry: article.sourcecountry || null,
          sourceType: classifySourceType({
            source: article.domain || article.sourcecountry || 'Unknown',
            sourceCountry: article.sourcecountry
          }),
          language: detectLanguage(article.title, article.language || null),
          geocodePrecision: geo.precision,
          geocodeMatchedOn: geo.matchedOn,
          socialimage: article.socialimage || null,
          isLive: true
        });
      }
    }

    return normalized;
  } catch {
    return [];
  }
}

// ── Build Briefing ───────────────────────────────────────────

export async function buildBriefing() {
  const [rssResult, gdeltArticles] = await Promise.all([
    fetchAllRss(),
    fetchGdelt()
  ]);

  const rssArticles = rssResult.articles;
  const allArticles = deduplicateArticles([...gdeltArticles, ...rssArticles]);
  allArticles.sort((a, b) => b.severity - a.severity);

  const events = canonicalizeArticles(allArticles);
  const coverageMetrics = calculateCoverageMetrics(events);
  const coverageDiagnostics = buildCoverageDiagnostics(events, { feeds: ALL_RSS_FEEDS });

  return {
    meta: {
      source: 'serverless',
      fetchedAt: new Date().toISOString(),
      totalFeeds: ALL_RSS_FEEDS.length,
      gdeltArticles: gdeltArticles.length,
      rssArticles: rssArticles.length,
      totalArticles: allArticles.length,
      totalEvents: events.length
    },
    articles: allArticles,
    events,
    coverageMetrics,
    coverageDiagnostics,
    sourceHealth: {
      gdelt: {
        status: gdeltArticles.length > 0 ? 'ok' : 'empty',
        articleCount: gdeltArticles.length,
        normalizedArticles: gdeltArticles.length,
        // Server uses 1 combined query, not 6 profiles
        totalProfiles: 1,
        healthyProfiles: gdeltArticles.length > 0 ? 1 : 0,
        failedProfiles: gdeltArticles.length > 0 ? 0 : 1,
      },
      rss: {
        status: rssArticles.length > 0 ? 'ok' : 'empty',
        articleCount: rssArticles.length,
        articlesFound: rssArticles.length,
        totalFeeds: rssResult.totalFeeds,
        healthyFeeds: rssResult.healthyFeeds,
        failedFeeds: rssResult.failedFeeds,
      },
      backend: { status: 'ok', source: 'serverless' }
    }
  };
}
