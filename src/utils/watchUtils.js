/**
 * watchUtils.js — Pure utility functions for the watch/alert system.
 * Matches articles against watchlist items (regions, topics, entities,
 * categories, severity thresholds, source types, verification statuses).
 */

/* ── Severity tier thresholds (numeric) ────────────────────────────────────── */
export const SEVERITY_TIERS = {
  CRITICAL: 85,
  ELEVATED: 60,
  WATCH: 35,
  LOW: 0,
};

/** Ordered from most to least severe */
export const SEVERITY_TIER_NAMES = ['CRITICAL', 'ELEVATED', 'WATCH', 'LOW'];

/**
 * Get the minimum numeric severity value for a named tier.
 * @param {string} tier - One of CRITICAL, ELEVATED, WATCH, LOW
 * @returns {number}
 */
export function severityThreshold(tier) {
  return SEVERITY_TIERS[tier] ?? 0;
}

/* ── Matching ──────────────────────────────────────────────────────────────── */

/**
 * Check whether a single article matches a watch item.
 *
 * Supported watch item types:
 *   - region:   Match by ISO-A2 country code (existing)
 *   - topic:    Match keyword against title/summary/category/region (existing)
 *   - entity:   Match against extracted named entities (existing)
 *   - category: Match against article.category (new)
 *   - severity: Match article.severity >= rule threshold tier (new)
 *   - sourceType: Match against article.sourceTypes or article.sourceType (new)
 *   - verificationStatus: Match against article.verificationStatus (new)
 *
 * @param {Object} article - An article/event object
 * @param {Object} watchItem - { type, value, label? }
 * @returns {boolean}
 */
export function matchArticleToWatch(article, watchItem) {
  if (!article || !watchItem) return false;

  switch (watchItem.type) {
    /* ── Legacy types ── */
    case 'region': {
      const iso = (watchItem.value || '').toUpperCase();
      return (article.isoA2 || '').toUpperCase() === iso;
    }
    case 'topic': {
      const keyword = (watchItem.value || '').toLowerCase();
      if (!keyword) return false;
      const haystack = [article.title, article.summary, article.category, article.region]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    }
    case 'entity': {
      const entityName = (watchItem.value || '').toLowerCase();
      if (!entityName || !article.entities) return false;
      const allEntities = [
        ...(article.entities.people || []),
        ...(article.entities.organizations || []),
        ...(article.entities.locations || []),
      ];
      return allEntities.some((e) => (e.name || '').toLowerCase().includes(entityName));
    }

    /* ── Enhanced rule types ── */
    case 'category': {
      const categoryVal = (watchItem.value || '').toLowerCase();
      if (!categoryVal) return false;
      return ((article.category || '').toLowerCase() === categoryVal);
    }
    case 'severity': {
      const tier = (watchItem.value || '').toUpperCase();
      const threshold = severityThreshold(tier);
      return (article.severity ?? 0) >= threshold;
    }
    case 'sourceType': {
      const targetType = (watchItem.value || '').toLowerCase();
      if (!targetType) return false;
      // Check sourceTypes array first, then fallback to sourceType property
      if (Array.isArray(article.sourceTypes)) {
        return article.sourceTypes.some((t) => (t || '').toLowerCase() === targetType);
      }
      if (article.sourceType) {
        return String(article.sourceType).toLowerCase() === targetType;
      }
      return false;
    }
    case 'verificationStatus': {
      const targetStatus = (watchItem.value || '').toLowerCase();
      if (!targetStatus) return false;
      return ((article.verificationStatus || '').toLowerCase() === targetStatus);
    }

    default:
      return false;
  }
}

/* ── Counting ──────────────────────────────────────────────────────────────── */

/**
 * Count article matches for each watch item and track last-match timestamps.
 *
 * @param {Array} articles - Array of article/event objects
 * @param {Array} watchItems - Array of watch items
 * @returns {{ counts: Object<string,number>, timestamps: Object<string,string|null> }}
 */
export function countMatchesForWatchItems(articles, watchItems) {
  if (!articles?.length || !watchItems?.length) {
    return { counts: {}, timestamps: {} };
  }

  const counts = {};
  const timestamps = {};

  for (const item of watchItems) {
    counts[item.id] = 0;
    timestamps[item.id] = null;
    let latestMatchTime = 0;

    for (const article of articles) {
      if (matchArticleToWatch(article, item)) {
        counts[item.id]++;

        // Track most recent matching article's publishedAt
        const articleTime = new Date(article.publishedAt || article.lastSeenAt || 0).getTime();
        if (articleTime > latestMatchTime) {
          latestMatchTime = articleTime;
        }
      }
    }

    if (latestMatchTime > 0) {
      timestamps[item.id] = new Date(latestMatchTime).toISOString();
    }
  }

  return { counts, timestamps };
}

/* ── New-match detection ────────────────────────────────────────────────────── */

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

/* ── Persistence ───────────────────────────────────────────────────────────── */

const WATCH_STORAGE_KEY = 'mapr-watchlist';
const WATCH_COUNTS_KEY = 'mapr-watchlist-counts';
const WATCH_TIMESTAMPS_KEY = 'mapr-watchlist-timestamps';

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

/**
 * Load last-match timestamps from localStorage.
 * @returns {Object} Map of watchId → ISO timestamp string or null
 */
export function loadWatchTimestamps() {
  try {
    const raw = localStorage.getItem(WATCH_TIMESTAMPS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Save last-match timestamps to localStorage.
 * @param {Object} timestamps - Map of watchId → ISO timestamp string or null
 */
export function saveWatchTimestamps(timestamps) {
  try {
    localStorage.setItem(WATCH_TIMESTAMPS_KEY, JSON.stringify(timestamps));
  } catch {
    // Storage full or unavailable
  }
}
