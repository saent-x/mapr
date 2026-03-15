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

// Cache and throttle state
let cachedArticles = null;
let cacheTimestamp = 0;
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const THROTTLE_MS = 5500; // 5.5 seconds between requests (GDELT asks for 5s)

/**
 * Fetch live news articles from GDELT DOC API.
 * Returns an array of normalized article objects matching the app's data format.
 */
export async function fetchLiveNews({ query = '', timespan = '24h', maxRecords = 150 } = {}) {
  const now = Date.now();

  // Return cache if fresh
  if (cachedArticles && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedArticles;
  }

  // Throttle requests
  const timeSinceLastFetch = now - lastFetchTime;
  if (timeSinceLastFetch < THROTTLE_MS) {
    await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS - timeSinceLastFetch));
  }

  const searchQuery = query || '(crisis OR disaster OR conflict OR earthquake OR flood OR war) sourcelang:english';

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

  // GDELT sometimes returns text errors with 200 status
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`GDELT returned non-JSON: ${text.slice(0, 80)}`);
  }
  const articles = data?.articles || [];

  // Transform and geocode articles
  const normalized = [];
  const seenTitles = new Set();

  for (const article of articles) {
    // Skip duplicates by title
    const titleKey = (article.title || '').toLowerCase().trim();
    if (seenTitles.has(titleKey) || !titleKey) continue;
    seenTitles.add(titleKey);

    // Geocode from title + source country
    const geo = geocodeArticle(article.title, article.sourcecountry);
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
