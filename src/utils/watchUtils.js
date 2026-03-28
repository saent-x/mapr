/**
 * watchUtils.js — Pure utility functions for the watch/alert system.
 * Matches articles against watchlist items (regions, topics, entities).
 */

/**
 * Check whether a single article matches a watch item.
 *
 * @param {Object} article - An article/event object with title, summary, isoA2, region, entities, etc.
 * @param {Object} watchItem - { type: 'region'|'topic'|'entity', value: string }
 * @returns {boolean}
 */
export function matchArticleToWatch(article, watchItem) {
  if (!article || !watchItem) return false;

  switch (watchItem.type) {
    case 'region': {
      // Match by ISO country code (case-insensitive)
      const iso = (watchItem.value || '').toUpperCase();
      return (article.isoA2 || '').toUpperCase() === iso;
    }
    case 'topic': {
      // Match keyword against title, summary, category
      const keyword = (watchItem.value || '').toLowerCase();
      if (!keyword) return false;
      const haystack = [article.title, article.summary, article.category, article.region]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    }
    case 'entity': {
      // Match against extracted entities (people, organizations, locations)
      const entityName = (watchItem.value || '').toLowerCase();
      if (!entityName || !article.entities) return false;
      const allEntities = [
        ...(article.entities.people || []),
        ...(article.entities.organizations || []),
        ...(article.entities.locations || []),
      ];
      return allEntities.some((e) => (e.name || '').toLowerCase().includes(entityName));
    }
    default:
      return false;
  }
}

/**
 * Count article matches for each watch item.
 *
 * @param {Array} articles - Array of article/event objects
 * @param {Array} watchItems - Array of watch items
 * @returns {Object} Map of watchItem.id → count of matching articles
 */
export function countMatchesForWatchItems(articles, watchItems) {
  if (!articles?.length || !watchItems?.length) return {};
  const counts = {};
  for (const item of watchItems) {
    counts[item.id] = 0;
    for (const article of articles) {
      if (matchArticleToWatch(article, item)) {
        counts[item.id]++;
      }
    }
  }
  return counts;
}

/**
 * Determine new article matches since last check.
 *
 * @param {Object} currentCounts - Current match counts { watchId: count }
 * @param {Object} previousCounts - Previous match counts { watchId: count }
 * @param {Array} watchItems - Watch items for label lookup
 * @returns {Array} Array of { watchId, label, type, newCount, totalCount }
 */
export function computeNewMatches(currentCounts, previousCounts, watchItems) {
  if (!currentCounts || !watchItems?.length) return [];

  const results = [];
  for (const item of watchItems) {
    const current = currentCounts[item.id] || 0;
    const previous = (previousCounts || {})[item.id] || 0;
    const diff = current - previous;
    if (diff > 0) {
      results.push({
        watchId: item.id,
        label: item.label,
        type: item.type,
        newCount: diff,
        totalCount: current,
      });
    }
  }
  return results;
}

const WATCH_STORAGE_KEY = 'mapr-watchlist';
const WATCH_COUNTS_KEY = 'mapr-watchlist-counts';

/**
 * Load watchlist from localStorage.
 * @returns {Array} Array of watch items
 */
export function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Save watchlist to localStorage.
 * @param {Array} items - Array of watch items
 */
export function saveWatchlist(items) {
  try {
    localStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage full or unavailable
  }
}

/**
 * Load saved match counts from localStorage.
 * @returns {Object} Map of watchId → count
 */
export function loadWatchCounts() {
  try {
    const raw = localStorage.getItem(WATCH_COUNTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Save match counts to localStorage.
 * @param {Object} counts - Map of watchId → count
 */
export function saveWatchCounts(counts) {
  try {
    localStorage.setItem(WATCH_COUNTS_KEY, JSON.stringify(counts));
  } catch {
    // Storage full or unavailable
  }
}
