/**
 * Pipeline Stage 2-4: Article Normalization and Deduplication
 *
 * Handles merging articles from multiple sources, normalizing them,
 * and removing duplicates (URL-based and title-similarity).
 */

import { deduplicateArticles } from '../../src/utils/articleUtils.js';
import { mergeRssArticles, retainPreviousGdeltArticles } from './fetchSources.js';

/**
 * Merge and deduplicate articles from all sources.
 *
 * Combines GDELT and RSS/HTML results, retains previous articles from
 * feeds not checked this run, and deduplicates by URL and title similarity.
 *
 * @param {Object} options
 * @param {Array} options.gdeltArticles - Articles from GDELT fetch
 * @param {Object} options.rssResult - RSS fetch result with articles, checkedFeedIds
 * @param {Array} options.previousArticles - Articles from the previous snapshot
 * @param {Array} options.catalog - Source catalog for feed lookup
 * @returns {Array} Deduplicated, merged article array
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

  // Combine all sources and deduplicate (URL + title similarity)
  return deduplicateArticles([...effectiveGdeltArticles, ...mergedRssArticles]);
}
