import { geocodeArticle, countryToIso } from '../utils/geocoder';
import { deriveSeverity, deriveCategory } from '../utils/articleUtils';

const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

/**
 * Parse GDELT seendate format (YYYYMMDDTHHmmssZ) to ISO string.
 */
function parseGdeltDate(seendate) {
  if (!seendate) return new Date().toISOString();

  const match = seendate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return new Date().toISOString();

  const [, year, month, day, hour, min, sec] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).toISOString();
}

// Multiple query themes to maximize global coverage
const GDELT_QUERIES = [
  // Crisis & conflict
  '(crisis OR disaster OR conflict OR earthquake OR flood OR war OR attack OR protest OR explosion) sourcelang:english',
  // Politics & governance
  '(government OR president OR minister OR parliament OR election OR policy OR law OR summit) sourcelang:english',
  // Economy & development
  '(economy OR trade OR inflation OR market OR investment OR infrastructure OR energy OR climate) sourcelang:english',
];

// Cache and throttle state
let cachedArticles = null;
let cacheTimestamp = 0;
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const THROTTLE_MS = 5500; // 5.5 seconds between requests (GDELT asks for 5s)

/**
 * Fetch a single GDELT query with throttling.
 */
async function fetchGdeltQuery(searchQuery, timespan, maxRecords) {
  // Throttle requests
  const now = Date.now();
  const timeSinceLastFetch = now - lastFetchTime;
  if (timeSinceLastFetch < THROTTLE_MS) {
    await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS - timeSinceLastFetch));
  }

  const params = new URLSearchParams({
    query: searchQuery,
    mode: 'artlist',
    format: 'json',
    timespan: timespan,
    maxrecords: String(maxRecords),
    sort: 'DateDesc'
  });

  const url = `${GDELT_DOC_URL}?${params}`;
  lastFetchTime = Date.now();

  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GDELT API returned ${response.status}: ${text.slice(0, 100)}`);
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`GDELT returned non-JSON: ${text.slice(0, 80)}`);
  }
  return data?.articles || [];
}

/**
 * Fetch live news articles from GDELT DOC API using multiple query themes.
 * Returns an array of normalized article objects matching the app's data format.
 */
export async function fetchLiveNews({ query = '', timespan = '24h', maxRecords = 200 } = {}) {
  const now = Date.now();

  // Return cache if fresh
  if (cachedArticles && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedArticles;
  }

  // If custom query, use single fetch
  const queries = query ? [query] : GDELT_QUERIES;
  const perQuery = Math.ceil(maxRecords / queries.length);

  // Fetch all queries sequentially (GDELT requires throttling)
  const allRaw = [];
  for (const q of queries) {
    try {
      const articles = await fetchGdeltQuery(q, timespan, perQuery);
      allRaw.push(...articles);
    } catch {
      // Continue with other queries if one fails
    }
  }

  // Transform and geocode articles
  const normalized = [];
  const seenTitles = new Set();

  for (const article of allRaw) {
    // Skip duplicates by title
    const titleKey = (article.title || '').toLowerCase().trim();
    if (seenTitles.has(titleKey) || !titleKey) continue;
    seenTitles.add(titleKey);

    // Geocode from title + source country
    const geo = geocodeArticle(article.title, article.sourcecountry, article.title);
    if (!geo) continue; // Skip articles we can't locate

    const severity = deriveSeverity(article.title);
    const category = deriveCategory(article.title);
    const iso = countryToIso(geo.region);

    normalized.push({
      id: `gdelt-${btoa(article.url || titleKey).slice(0, 16)}-${normalized.length}`,
      title: article.title,
      summary: article.title, // GDELT artlist doesn't provide summaries
      url: article.url,
      severity,
      publishedAt: parseGdeltDate(article.seendate),
      region: geo.region,
      isoA2: iso || 'XX',
      locality: geo.locality,
      category,
      coordinates: [geo.lat, geo.lng],
      source: article.domain || 'Unknown',
      socialimage: article.socialimage || null,
      isLive: true
    });
  }

  // Sort by severity descending
  normalized.sort((a, b) => b.severity - a.severity);

  cachedArticles = normalized;
  cacheTimestamp = Date.now();

  return normalized;
}

/**
 * Clear the cache (useful when changing queries).
 */
export function clearCache() {
  cachedArticles = null;
  cacheTimestamp = 0;
}
