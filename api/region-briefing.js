import { ALL_RSS_FEEDS } from '../src/services/rssService.js';
import { parseFeedItems } from '../server/rssParser.js';
import { geocodeArticleAll, countryToIso, isoToCountry } from '../src/utils/geocoder.js';
import { deriveSeverity, deriveCategory, deduplicateArticles } from '../src/utils/articleUtils.js';
import { classifySourceType } from '../src/utils/sourceMetadata.js';
import { detectLanguage } from '../src/utils/languageUtils.js';
import { canonicalizeArticles } from '../src/utils/newsPipeline.js';
import { buildRegionSourcePlan } from '../src/utils/sourceCoverage.js';

const FEED_TIMEOUT_MS = 5000;

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

function normalizeArticle(item, feed, index) {
  if (!item?.title) return [];
  const geos = geocodeArticleAll(item.title, feed.country, item.summary);
  if (geos.length === 0) return [];

  const date = new Date(item.publishedAt || Date.now());
  const publishedAt = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  const baseId = `rss-region-${feed.id}-${index}`;

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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }

  const iso = (req.query?.iso || '').toUpperCase();
  if (!iso) {
    return res.status(400).json({ error: 'Missing iso query parameter' });
  }

  const regionName = isoToCountry(iso) || iso;

  // Find feeds relevant to this region
  const regionFeeds = ALL_RSS_FEEDS.filter((feed) => {
    if (feed.country && countryToIso(feed.country) === iso) return true;
    if (Array.isArray(feed.coverageCountries)) {
      return feed.coverageCountries.some((c) => countryToIso(c) === iso);
    }
    return false;
  });

  // Also include global/wire feeds
  const globalFeeds = ALL_RSS_FEEDS.filter((feed) =>
    !feed.country && (feed.sourceType === 'wire' || feed.sourceType === 'global')
  );

  const feedsToFetch = [...new Set([...regionFeeds, ...globalFeeds])];

  const results = await Promise.allSettled(
    feedsToFetch.map(async (feed) => {
      try {
        const xmlText = await fetchText(feed.url);
        const items = parseFeedItems(xmlText);
        return items.flatMap((item, i) => normalizeArticle(item, feed, i));
      } catch {
        return [];
      }
    })
  );

  const allArticles = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allArticles.push(...result.value);
    }
  }

  const regionArticles = deduplicateArticles(allArticles).filter((a) => a.isoA2 === iso);
  regionArticles.sort((a, b) => b.severity - a.severity);
  const events = canonicalizeArticles(regionArticles);
  const sourcePlan = buildRegionSourcePlan(regionName);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    iso,
    region: regionName,
    fetchedAt: new Date().toISOString(),
    articles: regionArticles,
    events,
    sourcePlan
  });
}
