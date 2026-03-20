import { countryToIso, isoToCountry } from '../src/utils/geocoder.js';
import { deduplicateArticles } from '../src/utils/articleUtils.js';
import { canonicalizeArticles } from '../src/utils/newsPipeline.js';
import { buildRegionSourcePlan, isRunnableFeed } from '../src/utils/sourceCoverage.js';
import { readSourceCatalog } from '../server/sourceCatalog.js';
import { fetchCatalogSource } from '../server/sourceFetcher.js';

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
  const sourceCatalog = await readSourceCatalog();
  const runnableFeeds = sourceCatalog.filter((feed) => isRunnableFeed(feed));

  // Find feeds relevant to this region
  const regionFeeds = runnableFeeds.filter((feed) => {
    if (feed.country && countryToIso(feed.country) === iso) return true;
    if (Array.isArray(feed.coverageCountries)) {
      return feed.coverageCountries.some((c) => countryToIso(c) === iso);
    }
    return false;
  });

  // Also include global/wire feeds
  const globalFeeds = runnableFeeds.filter((feed) =>
    !feed.country && (feed.sourceType === 'wire' || feed.sourceType === 'global')
  );

  const feedsToFetch = [...new Set([...regionFeeds, ...globalFeeds])];

  const results = await Promise.allSettled(
    feedsToFetch.map(async (feed) => {
      try {
        const result = await fetchCatalogSource(feed, { idPrefix: 'region' });
        return result.articles;
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
  const sourcePlan = buildRegionSourcePlan(regionName, {
    feeds: sourceCatalog
  });

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
