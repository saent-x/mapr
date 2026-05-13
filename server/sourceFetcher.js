import { parseFeedItems } from './rssParser.js';
import { parseHtmlSourceItems } from './htmlSourceParser.js';
import { geocodeArticleAll, countryToIso } from '../src/utils/geocoder.js';
import { deriveCategory, deriveSeverity } from '../src/utils/articleUtils.js';
import { classifySourceType } from '../src/utils/sourceMetadata.js';
import { getFeedCoverageCountries, getFeedCoverageIsos } from '../src/utils/sourceCoverage.js';
import { detectLanguage } from '../src/utils/languageUtils.js';
import { isPublicHttpUrl } from './urlGuard.js';

export const DEFAULT_REQUEST_TIMEOUT_MS = 14000;
// Hard cap on a single feed response. Keeps a hostile or buggy feed
// from OOM-ing the server with a multi-hundred-MB payload.
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_SOURCE_REQUEST_HEADERS = {
  accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, text/html;q=0.8, */*;q=0.1',
  'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
};

export async function fetchText(url, {
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  headers = DEFAULT_SOURCE_REQUEST_HEADERS,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
} = {}) {
  if (!isPublicHttpUrl(url)) {
    throw new Error('Refusing to fetch non-public URL');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Pre-flight: a Content-Length larger than maxBytes is rejected before
    // we read any of the body.
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) {
      throw new Error(`Response too large (${declared} bytes)`);
    }

    // Stream the response and abort if accumulated bytes cross the cap.
    if (!response.body) return await response.text();
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new Error(`Response too large (>${maxBytes} bytes)`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSourceArticle(item, feed, index, { idPrefix = 'source' } = {}) {
  if (!item?.title) {
    return [];
  }

  const geos = geocodeArticleAll(item.title, feed.country, item.summary);
  if (geos.length === 0) {
    return [];
  }

  const publishedDate = new Date(item.publishedAt || Date.now());
  const publishedAt = Number.isNaN(publishedDate.getTime())
    ? new Date().toISOString()
    : publishedDate.toISOString();
  const baseId = `${feed.fetchMode || 'rss'}-${idPrefix}-${feed.id}-${index}`;

  return geos.map((geo, geoIdx) => ({
    id: geos.length > 1 ? `${baseId}-${geoIdx}` : baseId,
    feedId: feed.id,
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

function buildSourceResult(feed, articles, { error = null } = {}) {
  return {
    feedId: feed.id,
    name: feed.name,
    sourceType: feed.sourceType || null,
    sourceClass: feed.sourceClass || null,
    fetchMode: feed.fetchMode || 'rss',
    cadenceMinutes: feed.cadenceMinutes || null,
    country: feed.country || null,
    isoA2: feed.country ? countryToIso(feed.country) || null : null,
    coverageCountries: getFeedCoverageCountries(feed),
    coverageIsoA2s: getFeedCoverageIsos(feed),
    status: error ? 'failed' : (articles.length > 0 ? 'ok' : 'empty'),
    articleCount: articles.length,
    error,
    articles
  };
}

export async function fetchCatalogSource(feed, { idPrefix = 'source' } = {}) {
  const fetchMode = feed?.fetchMode || 'rss';

  try {
    const rawText = await fetchText(feed.url);
    const parsedItems = fetchMode === 'html'
      ? parseHtmlSourceItems(rawText, feed.url)
      : parseFeedItems(rawText);
    const articles = parsedItems.flatMap((item, index) => normalizeSourceArticle(item, feed, index, { idPrefix }));
    return buildSourceResult(feed, articles);
  } catch (error) {
    return buildSourceResult(feed, [], { error: error.message });
  }
}
