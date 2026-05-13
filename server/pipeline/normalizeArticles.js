/**
 * Pipeline Stage 2-4: Article Normalization and Deduplication
 *
 * Handles merging articles from multiple sources, normalizing them,
 * and removing duplicates (URL-based and title-similarity).
 * When duplicate articles arrive from different feeds, source metadata
 * is merged so the surviving entry records all original sources.
 */

import { deduplicateArticles } from '../../src/utils/articleUtils.js';
import { mergeRssArticles, retainPreviousGdeltArticles } from './fetchSources.js';

const TRACKING_PARAM_PATTERNS = [
  /^utm_/i, /^fbclid$/i, /^gclid$/i, /^msclkid$/i, /^mc_(cid|eid)$/i,
  /^_ga$/i, /^igshid$/i, /^ref$/i, /^ref_(src|url)$/i, /^s_(cid|kwcid)$/i, /^yclid$/i,
];

function isTrackingParam(name) {
  return TRACKING_PARAM_PATTERNS.some((re) => re.test(name));
}

function normalizeUrlForDedup(url) {
  if (!url) return '';
  let parsed;
  try { parsed = new URL(url); }
  catch { return String(url).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/#.*$/, '').replace(/\/$/, ''); }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  const params = [];
  for (const [k, v] of parsed.searchParams.entries()) {
    if (isTrackingParam(k)) continue;
    params.push([k.toLowerCase(), v]);
  }
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '';
  return `${host}${path}${query}`;
}

/**
 * Merge source metadata when the same article appears in multiple feeds.
 *
 * For each article, tracks which feed IDs (and their names) contributed
 * the article. The surviving entry carries a `sources` array recording
 * every feed that reported it.
 *
 * @param {Array} articles - Deduplicated article array
 * @param {Array} allCandidates - All original articles before dedup
 * @param {Array} catalog - Source catalog for feed name lookup
 * @returns {Array} Articles with merged source metadata
 */
export function mergeSourceMetadata(articles, allCandidates, catalog = []) {
  if (!articles || !articles.length) return articles || [];

  // Build normalized-URL → list of source infos from all candidates
  const sourceMap = new Map();

  for (const candidate of (allCandidates || [])) {
    const urlKey = normalizeUrlForDedup(candidate.url);

    if (!urlKey) continue;

    const sourceInfo = {
      source: candidate.source || 'unknown',
      sourceCountry: candidate.sourceCountry || null,
      sourceType: candidate.sourceType || null,
      feedId: candidate.feedId || null,
    };

    const existing = sourceMap.get(urlKey);
    if (!existing) {
      sourceMap.set(urlKey, [sourceInfo]);
    } else {
      // Avoid duplicate entries from same feed
      const alreadyTracked = existing.some(
        (s) => s.feedId && s.feedId === sourceInfo.feedId
      );
      if (!alreadyTracked) {
        existing.push(sourceInfo);
      }
    }
  }

  // Also index by normalized title for title-similarity matches
  const titleSourceMap = new Map();
  const normalizeForLookup = (title) =>
    (title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

  for (const candidate of (allCandidates || [])) {
    const titleKey = normalizeForLookup(candidate.title);
    if (!titleKey) continue;

    const sourceInfo = {
      source: candidate.source || 'unknown',
      sourceCountry: candidate.sourceCountry || null,
      sourceType: candidate.sourceType || null,
      feedId: candidate.feedId || null,
    };

    const existing = titleSourceMap.get(titleKey);
    if (!existing) {
      titleSourceMap.set(titleKey, [sourceInfo]);
    } else {
      const alreadyTracked = existing.some(
        (s) => s.feedId && s.feedId === sourceInfo.feedId
      );
      if (!alreadyTracked) {
        existing.push(sourceInfo);
      }
    }
  }

  // Enrich each surviving article with merged source metadata
  return articles.map((article) => {
    const urlKey = normalizeUrlForDedup(article.url);

    const titleKey = normalizeForLookup(article.title);

    // Collect all source infos: URL match + title match
    const urlSources = urlKey ? (sourceMap.get(urlKey) || []) : [];
    const titleSources = titleKey ? (titleSourceMap.get(titleKey) || []) : [];

    const seenSources = new Set();
    const merged = [];

    for (const src of [...urlSources, ...titleSources]) {
      const key = `${src.source}::${src.feedId || ''}`;
      if (!seenSources.has(key)) {
        seenSources.add(key);
        merged.push(src);
      }
    }

    // Resolve feed names from catalog
    const resolvedSources = merged.map((s) => {
      if (s.feedId && catalog.length > 0) {
        const catalogEntry = catalog.find((f) => f.id === s.feedId);
        if (catalogEntry) {
          return { ...s, feedName: catalogEntry.name };
        }
      }
      return s;
    });

    return {
      ...article,
      sources: resolvedSources.length > 0 ? resolvedSources : [
        {
          source: article.source || 'unknown',
          sourceCountry: article.sourceCountry || null,
          sourceType: article.sourceType || null,
          feedId: article.feedId || null,
        },
      ],
      sourceDiversity: resolvedSources.length,
    };
  });
}

/**
 * Merge and deduplicate articles from all sources.
 *
 * Combines GDELT and RSS/HTML results, retains previous articles from
 * feeds not checked this run, and deduplicates by URL and title similarity.
 * When the same article appears in multiple feeds, source metadata is
 * merged into a single entry recording all original sources.
 *
 * @param {Object} options
 * @param {Array} options.gdeltArticles - Articles from GDELT fetch
 * @param {Object} options.rssResult - RSS fetch result with articles, checkedFeedIds
 * @param {Array} options.previousArticles - Articles from the previous snapshot
 * @param {Array} options.catalog - Source catalog for feed lookup
 * @returns {Array} Deduplicated, merged article array with source metadata
 */
export function mergeAndDeduplicateArticles({ gdeltArticles, rssResult, previousArticles, catalog }) {
  // Fall back to previous GDELT articles if current fetch returned empty
  const effectiveGdeltArticles = gdeltArticles.length > 0
    ? gdeltArticles
    : retainPreviousGdeltArticles(previousArticles);

  // Merge RSS: keep articles from feeds not checked this run, add new results
  const mergedRssArticles = mergeRssArticles(
    previousArticles,
    rssResult.checkedFeedIds || [],
    rssResult.articles,
    catalog
  );

  // Combine all sources for deduplication
  const allCandidates = [...effectiveGdeltArticles, ...mergedRssArticles];

  // Deduplicate (URL + title similarity)
  const deduped = deduplicateArticles(allCandidates);

  // Merge source metadata from all original candidates into the surviving entries
  return mergeSourceMetadata(deduped, allCandidates, catalog);
}
