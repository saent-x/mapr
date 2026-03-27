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

// Keep queries simple — GDELT silently returns 0 for overly complex queries
export const GDELT_QUERY_PROFILES = [
  // Original profiles
  { id: 'crisis', query: '(crisis OR conflict OR disaster OR attack OR protest OR earthquake)' },
  { id: 'humanitarian', query: '(flood OR famine OR outbreak OR displacement OR evacuation OR drought)' },
  { id: 'governance', query: '(government OR president OR election OR sanctions OR summit OR parliament)' },
  // New thematic profiles
  { id: 'economic', query: '(economy OR trade OR inflation OR poverty OR unemployment OR GDP OR debt OR currency)' },
  { id: 'health', query: '(epidemic OR pandemic OR disease OR vaccination OR WHO OR cholera OR malaria OR health crisis)' },
  { id: 'environmental', query: '(climate OR deforestation OR pollution OR wildfire OR cyclone OR tsunami OR emissions OR biodiversity)' },
  { id: 'technology', query: '(cybersecurity OR surveillance OR AI OR disinformation OR internet shutdown OR censorship OR hacking)' },
];

/**
 * Region-specific queries using sourcecountry: to target articles from underrepresented countries.
 * GDELT DOC 2.0 API supports sourcecountry:XX (2-letter FIPS/ISO code).
 */
export const GDELT_REGION_QUERIES = [
  // Sub-Saharan Africa
  { id: 'africa-west', query: 'sourcecountry:NI OR sourcecountry:GH OR sourcecountry:SN OR sourcecountry:ML OR sourcecountry:BF' },
  { id: 'africa-east', query: 'sourcecountry:KE OR sourcecountry:ET OR sourcecountry:TZ OR sourcecountry:UG OR sourcecountry:RW' },
  { id: 'africa-central', query: 'sourcecountry:CD OR sourcecountry:CM OR sourcecountry:CG OR sourcecountry:GA OR sourcecountry:TD' },
  { id: 'africa-southern', query: 'sourcecountry:ZA OR sourcecountry:MZ OR sourcecountry:ZW OR sourcecountry:ZM OR sourcecountry:MW' },
  // Central and South Asia
  { id: 'asia-central', query: 'sourcecountry:KZ OR sourcecountry:UZ OR sourcecountry:TM OR sourcecountry:KG OR sourcecountry:TI' },
  { id: 'asia-south', query: 'sourcecountry:IN OR sourcecountry:PK OR sourcecountry:BG OR sourcecountry:NP OR sourcecountry:CE' },
  // Southeast Asia & Pacific
  { id: 'asia-southeast', query: 'sourcecountry:MY OR sourcecountry:ID OR sourcecountry:TH OR sourcecountry:VM OR sourcecountry:BM' },
  { id: 'pacific-islands', query: 'sourcecountry:FJ OR sourcecountry:PP OR sourcecountry:WS OR sourcecountry:TN' },
  // Latin America & Caribbean
  { id: 'latam-central', query: 'sourcecountry:GT OR sourcecountry:HO OR sourcecountry:NU OR sourcecountry:ES OR sourcecountry:PM' },
  { id: 'latam-south', query: 'sourcecountry:BL OR sourcecountry:PA OR sourcecountry:EC OR sourcecountry:PE OR sourcecountry:UY' },
  { id: 'caribbean', query: 'sourcecountry:CU OR sourcecountry:HA OR sourcecountry:DR OR sourcecountry:JM OR sourcecountry:TD' },
  // Eastern Europe & Caucasus
  { id: 'europe-east', query: 'sourcecountry:BO OR sourcecountry:MD OR sourcecountry:GG OR sourcecountry:AM OR sourcecountry:AJ' },
];

/**
 * Language-specific queries using sourcelang: to capture non-English coverage.
 * GDELT DOC 2.0 API supports sourcelang:language_name.
 */
export const GDELT_LANGUAGE_QUERIES = [
  { id: 'lang-spanish', query: 'sourcelang:spanish (crisis OR conflict OR gobierno OR elección OR protesta OR desastre)' },
  { id: 'lang-french', query: 'sourcelang:french (crise OR conflit OR gouvernement OR élection OR catastrophe OR manifestation)' },
  { id: 'lang-arabic', query: 'sourcelang:arabic (crisis OR conflict OR government OR protest OR disaster OR election)' },
  { id: 'lang-portuguese', query: 'sourcelang:portuguese (crise OR conflito OR governo OR eleição OR desastre OR protesto)' },
  { id: 'lang-russian', query: 'sourcelang:russian (crisis OR conflict OR government OR protest OR disaster OR election)' },
  { id: 'lang-chinese', query: 'sourcelang:chinese (crisis OR conflict OR government OR protest OR disaster OR election)' },
];

/**
 * Returns all default query profiles: base thematic + region-specific + language-specific.
 * Used by fetchLiveNews when no custom queries are supplied.
 */
export function getDefaultQueryProfiles() {
  return [...GDELT_QUERY_PROFILES, ...GDELT_REGION_QUERIES, ...GDELT_LANGUAGE_QUERIES];
}

// Cache and throttle state
const gdeltCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const THROTTLE_MS = 6500; // Keep a safer gap than GDELT's stated 5 seconds.
const RETRY_BACKOFF_MS = 8500;
let lastFetchCompletedAt = 0;
let gdeltRequestQueue = Promise.resolve();

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueueGdeltRequest(task) {
  const run = gdeltRequestQueue
    .catch(() => {})
    .then(async () => {
      const elapsedSinceLastCompletion = Date.now() - lastFetchCompletedAt;
      if (elapsedSinceLastCompletion < THROTTLE_MS) {
        await wait(THROTTLE_MS - elapsedSinceLastCompletion);
      }

      try {
        return await task();
      } finally {
        lastFetchCompletedAt = Date.now();
      }
    });

  gdeltRequestQueue = run.then(() => undefined, () => undefined);
  return run;
}

function buildCacheKey({ query = '', queries = [], timespan = '24h', maxRecords = 750 } = {}) {
  return JSON.stringify({
    query: query.trim(),
    queries: Array.isArray(queries) ? queries.map((entry) => (
      typeof entry === 'string' ? entry.trim() : entry?.query?.trim?.() || ''
    )) : [],
    timespan,
    maxRecords
  });
}

const REGION_FOCUS_THEME = 'crisis OR conflict OR disaster OR attack OR protest OR earthquake OR government OR election OR sanctions';

export function buildRegionFocusQuery(regionName) {
  const normalizedRegion = normalizeArticleText(regionName);
  if (!normalizedRegion) {
    throw new Error('Missing region name for GDELT focus query');
  }

  return `("${normalizedRegion}") AND (${REGION_FOCUS_THEME})`;
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

  // Add sourcecountry: query when ISO code is available for targeted coverage
  const isoCode = countryToIso(regionName);
  if (isoCode) {
    queries.push({
      id: 'region-sourcecountry',
      query: `sourcecountry:${isoCode} (${REGION_FOCUS_THEME})`
    });
  }

  if (geoHints.aliases.length > 0) {
    const aliasTerms = [...new Set([normalizedRegion, ...geoHints.aliases.map(normalizeArticleText)])]
      .filter(Boolean)
      .map(quoteTerm);
    queries.push({
      id: 'region-aliases',
      query: `(${aliasTerms.join(' OR ')}) AND (${REGION_FOCUS_THEME})`
    });
  }

  if (geoHints.localities.length > 0) {
    const localityTerms = [...new Set([normalizedRegion, ...geoHints.localities.map(normalizeArticleText)])]
      .filter(Boolean)
      .map(quoteTerm);
    queries.push({
      id: 'region-localities',
      query: `(${localityTerms.join(' OR ')}) AND (${REGION_FOCUS_THEME})`
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
  return enqueueGdeltRequest(async () => {
    const executeFetch = async () => {
      const useProxy = typeof window !== 'undefined';

      let response;
      if (useProxy) {
        const params = new URLSearchParams({
          query: searchQuery,
          timespan,
          maxrecords: String(maxRecords),
        });
        response = await fetch(`/api/gdelt-proxy?${params}`);
      } else {
        const params = new URLSearchParams({
          query: searchQuery,
          mode: 'artlist',
          format: 'json',
          timespan,
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
    };

    try {
      return await executeFetch();
    } catch (error) {
      if (!String(error?.message || '').includes('429')) {
        throw error;
      }

      await wait(RETRY_BACKOFF_MS);
      return executeFetch();
    }
  });
}

/**
 * Fetch live news articles from GDELT DOC API using multiple query themes.
 * Returns an array of normalized article objects matching the app's data format.
 */
export async function fetchLiveNews({ query = '', queries = [], timespan = '24h', maxRecords = 750 } = {}) {
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
    : (query ? [{ id: 'custom', query }] : getDefaultQueryProfiles());
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
  lastFetchCompletedAt = 0;
  lastFetchHealth = createEmptyGdeltHealth();
}
