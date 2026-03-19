import { geocodeArticleAll, countryToIso, getCountryGeoHints } from '../utils/geocoder.js';
import { deriveSeverity, deriveCategory } from '../utils/articleUtils.js';
import { classifySourceType } from '../utils/sourceMetadata.js';
import { detectLanguage } from '../utils/languageUtils.js';
import { encodeBase64 } from '../utils/base64.js';
import { normalizeArticleText } from '../utils/articleText.js';

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

const COVERAGE_THEME = [
  'crisis', 'disaster', 'conflict', 'earthquake', 'flood', 'storm', 'wildfire',
  'drought', 'famine', 'protest', 'attack', 'explosion', 'outbreak', 'aid',
  'displacement', 'blackout', 'landslide', 'evacuation', 'ceasefire'
].join(' OR ');

const GOVERNANCE_THEME = [
  'government', 'president', 'minister', 'parliament', 'election', 'policy',
  'law', 'summit', 'sanctions', 'trade', 'infrastructure', 'energy'
].join(' OR ');

const REGION_BUCKETS = {
  africa: ['Sudan', 'Nigeria', 'Kenya', 'Ethiopia', 'South Africa', 'Democratic Republic of the Congo', 'Ghana', 'Egypt', 'Mozambique', 'Somalia', 'Algeria', 'Tunisia', 'Libya', 'Mali', 'Cameroon', 'Ivory Coast', 'Senegal', 'Chad', 'Guinea', 'Burkina Faso', 'Niger', 'Uganda', 'Tanzania', 'Angola', 'Zambia', 'Zimbabwe', 'Rwanda', 'Madagascar', 'Botswana', 'Namibia'],
  middleEast: ['Israel', 'Palestine', 'Lebanon', 'Syria', 'Iraq', 'Iran', 'Yemen', 'Jordan', 'Saudi Arabia', 'Turkey'],
  asia: ['India', 'Pakistan', 'Bangladesh', 'China', 'Japan', 'Indonesia', 'Philippines', 'Thailand', 'Myanmar', 'Afghanistan'],
  europe: ['Ukraine', 'Russia', 'Germany', 'France', 'United Kingdom', 'Poland', 'Italy', 'Spain', 'Romania', 'Turkey'],
  americas: ['United States', 'Canada', 'Mexico', 'Brazil', 'Argentina', 'Colombia', 'Peru', 'Chile', 'Ecuador', 'Haiti'],
  oceania: ['Australia', 'New Zealand', 'Papua New Guinea', 'Fiji', 'Solomon Islands']
};

const buildRegionQuery = (regionNames, theme) => (
  `(${theme}) AND (${regionNames.map((name) => `"${name}"`).join(' OR ')})`
);

export const GDELT_QUERY_PROFILES = [
  { id: 'global-crisis', query: `(${COVERAGE_THEME})` },
  { id: 'global-governance', query: `(${GOVERNANCE_THEME})` },
  { id: 'africa-middle-east', query: `${buildRegionQuery([...REGION_BUCKETS.africa, ...REGION_BUCKETS.middleEast], COVERAGE_THEME)}` },
  { id: 'asia', query: `${buildRegionQuery(REGION_BUCKETS.asia, COVERAGE_THEME)}` },
  { id: 'europe', query: `${buildRegionQuery(REGION_BUCKETS.europe, GOVERNANCE_THEME)}` },
  { id: 'americas-oceania', query: `${buildRegionQuery([...REGION_BUCKETS.americas, ...REGION_BUCKETS.oceania], COVERAGE_THEME)}` }
];

// Cache and throttle state
const gdeltCache = new Map();
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const THROTTLE_MS = 5500; // 5.5 seconds between requests (GDELT asks for 5s)

function createEmptyGdeltHealth() {
  return {
    lastUpdated: null,
    fromCache: false,
    totalProfiles: 0,
    healthyProfiles: 0,
    emptyProfiles: 0,
    failedProfiles: 0,
    rawArticles: 0,
    normalizedArticles: 0,
    profiles: []
  };
}

let lastFetchHealth = createEmptyGdeltHealth();

function buildCacheKey({ query = '', queries = [], timespan = '24h', maxRecords = 200 } = {}) {
  return JSON.stringify({
    query: query.trim(),
    queries: Array.isArray(queries) ? queries.map((entry) => (
      typeof entry === 'string' ? entry.trim() : entry?.query?.trim?.() || ''
    )) : [],
    timespan,
    maxRecords
  });
}

export function buildRegionFocusQuery(regionName) {
  const normalizedRegion = normalizeArticleText(regionName);
  if (!normalizedRegion) {
    throw new Error('Missing region name for GDELT focus query');
  }

  return `("${normalizedRegion}") AND ((${COVERAGE_THEME}) OR (${GOVERNANCE_THEME}))`;
}

export function buildRegionFocusQueries(regionName) {
  const normalizedRegion = normalizeArticleText(regionName);
  if (!normalizedRegion) {
    throw new Error('Missing region name for GDELT focus query');
  }

  const geoHints = getCountryGeoHints(regionName, {
    maxAliases: 3,
    maxLocalities: 3
  });
  const quoteTerm = (term) => `"${normalizeArticleText(term).replace(/"/g, '')}"`;
  const queries = [
    {
      id: 'region-name',
      query: buildRegionFocusQuery(regionName)
    }
  ];

  if (geoHints.aliases.length > 0) {
    const aliasTerms = [...new Set([normalizedRegion, ...geoHints.aliases.map(normalizeArticleText)])]
      .filter(Boolean)
      .map(quoteTerm);
    queries.push({
      id: 'region-aliases',
      query: `(${aliasTerms.join(' OR ')}) AND ((${COVERAGE_THEME}) OR (${GOVERNANCE_THEME}))`
    });
  }

  if (geoHints.localities.length > 0) {
    const localityTerms = [...new Set([normalizedRegion, ...geoHints.localities.map(normalizeArticleText)])]
      .filter(Boolean)
      .map(quoteTerm);
    queries.push({
      id: 'region-localities',
      query: `(${localityTerms.join(' OR ')}) AND ((${COVERAGE_THEME}) OR (${GOVERNANCE_THEME}))`
    });
  }

  return queries.filter((entry, index, items) => (
    items.findIndex((candidate) => candidate.query === entry.query) === index
  ));
}

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

  lastFetchTime = Date.now();

  // Use server proxy to avoid CORS issues in the browser
  const useProxy = typeof window !== 'undefined';

  let response;
  if (useProxy) {
    const params = new URLSearchParams({
      query: searchQuery,
      timespan: timespan,
      maxrecords: String(maxRecords),
    });
    response = await fetch(`/api/gdelt-proxy?${params}`);
  } else {
    const params = new URLSearchParams({
      query: searchQuery,
      mode: 'artlist',
      format: 'json',
      timespan: timespan,
      maxrecords: String(maxRecords),
      sort: 'DateDesc'
    });
    response = await fetch(`${GDELT_DOC_URL}?${params}`);
  }

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
export async function fetchLiveNews({ query = '', queries = [], timespan = '24h', maxRecords = 200 } = {}) {
  const now = Date.now();
  const cacheKey = buildCacheKey({ query, queries, timespan, maxRecords });

  // Return cache if fresh
  const cachedEntry = gdeltCache.get(cacheKey);
  if (cachedEntry && (now - cachedEntry.timestamp) < CACHE_TTL) {
    lastFetchHealth = {
      ...lastFetchHealth,
      fromCache: true
    };
    return cachedEntry.articles;
  }

  // If custom query, use single fetch
  const queryProfiles = Array.isArray(queries) && queries.length > 0
    ? queries.map((entry, index) => (
      typeof entry === 'string'
        ? { id: `custom-${index}`, query: entry }
        : { id: entry.id || `custom-${index}`, query: entry.query }
    )).filter((entry) => entry.query)
    : (query ? [{ id: 'custom', query }] : GDELT_QUERY_PROFILES);
  if (queryProfiles.length === 0) {
    return [];
  }
  const perQuery = Math.ceil(maxRecords / queryProfiles.length);

  // Fetch all queries sequentially (GDELT requires throttling)
  const allRaw = [];
  const profileHealth = [];
  for (const profile of queryProfiles) {
    try {
      const articles = await fetchGdeltQuery(profile.query, timespan, perQuery);
      allRaw.push(...articles.map((article) => ({ ...article, coverageProfile: profile.id })));
      profileHealth.push({
        id: profile.id,
        status: articles.length > 0 ? 'ok' : 'empty',
        rawArticles: articles.length,
        error: null
      });
    } catch (error) {
      // Continue with other queries if one fails
      profileHealth.push({
        id: profile.id,
        status: 'failed',
        rawArticles: 0,
        error: error.message
      });
    }
  }

  // Transform and geocode articles
  const normalized = [];
  const seenUrls = new Set();

  for (const article of allRaw) {
    const titleKey = (article.title || '').toLowerCase().trim();
    if (!titleKey) continue;
    const urlKey = (article.url || '').toLowerCase().trim();
    if (urlKey && seenUrls.has(urlKey)) continue;
    if (urlKey) seenUrls.add(urlKey);

    // Geocode from title + source country — may return multiple countries
    const geos = geocodeArticleAll(article.title, article.sourcecountry, article.title);
    if (geos.length === 0) continue;

    const severity = deriveSeverity(article.title);
    const category = deriveCategory(article.title);
    const sourceName = article.domain || article.domainname || article.sourcecountry || 'Unknown';
    const sourceCountry = article.sourcecountry || null;
    const baseId = `gdelt-${encodeBase64(article.url || titleKey).slice(0, 16)}-${normalized.length}`;

    for (let gi = 0; gi < geos.length; gi++) {
      const geo = geos[gi];
      normalized.push({
        id: geos.length > 1 ? `${baseId}-${gi}` : baseId,
        title: article.title,
        summary: article.title,
        url: article.url,
        severity,
        publishedAt: parseGdeltDate(article.seendate),
        region: geo.region,
        isoA2: countryToIso(geo.region) || 'XX',
        locality: geo.locality,
        category,
        coordinates: [geo.lat, geo.lng],
        source: sourceName,
        sourceCountry,
        sourceType: classifySourceType({ source: sourceName, sourceCountry }),
        language: detectLanguage(article.title, article.language || null),
        geocodePrecision: geo.precision,
        geocodeMatchedOn: geo.matchedOn,
        coverageProfile: article.coverageProfile,
        socialimage: article.socialimage || null,
        isLive: true
      });
    }
  }

  // Sort by severity descending
  normalized.sort((a, b) => b.severity - a.severity);

  lastFetchHealth = {
    lastUpdated: new Date().toISOString(),
    fromCache: false,
    totalProfiles: queryProfiles.length,
    healthyProfiles: profileHealth.filter((profile) => profile.status === 'ok').length,
    emptyProfiles: profileHealth.filter((profile) => profile.status === 'empty').length,
    failedProfiles: profileHealth.filter((profile) => profile.status === 'failed').length,
    rawArticles: allRaw.length,
    normalizedArticles: normalized.length,
    profiles: profileHealth
  };

  gdeltCache.set(cacheKey, {
    articles: normalized,
    timestamp: Date.now()
  });

  return normalized;
}

export function getGdeltFetchHealth() {
  return lastFetchHealth;
}

/**
 * Clear the cache (useful when changing queries).
 */
export function clearCache() {
  gdeltCache.clear();
  lastFetchHealth = createEmptyGdeltHealth();
}
