import { create } from 'zustand';
import {
  loadWatchlist,
  saveWatchlist,
  loadWatchCounts,
  saveWatchCounts,
  countMatchesForWatchItems,
  computeNewMatches,
} from '../utils/watchUtils.js';

/**
 * Watch store — manages the watchlist (regions, topics, entities),
 * article match counts, and new-match notifications.
 *
 * Watchlist items and counts persist in localStorage across sessions.
 */
const useWatchStore = create((set, get) => ({
  /* ── state ── */
  watchItems: typeof window !== 'undefined' ? loadWatchlist() : [],
  matchCounts: typeof window !== 'undefined' ? loadWatchCounts() : {},
  notifications: [], // Array of { watchId, label, type, newCount, totalCount, timestamp }

  /* ────────── actions ────────── */

  /**
   * Add a new watch item.
   * @param {'region'|'topic'|'entity'} type
   * @param {string} value - ISO code, keyword, or entity name
   * @param {string} label - Human-readable label
   */
  addWatch: (type, value, label) => {
    if (!type || !value?.trim()) return;
    const normalizedValue = value.trim();
    const existing = get().watchItems;

    // Prevent duplicates
    if (existing.some((item) => item.type === type && item.value.toLowerCase() === normalizedValue.toLowerCase())) {
      return;
    }

    const newItem = {
      id: `${type}-${normalizedValue}-${Date.now()}`,
      type,
      value: normalizedValue,
      label: label || normalizedValue,
      addedAt: new Date().toISOString(),
    };

    set((s) => {
      const next = [...s.watchItems, newItem];
      saveWatchlist(next);
      return { watchItems: next };
    });
  },

  /**
   * Remove a watch item by id.
   * @param {string} id
   */
  removeWatch: (id) => {
    set((s) => {
      const next = s.watchItems.filter((item) => item.id !== id);
      saveWatchlist(next);
      // Also clean up counts
      const nextCounts = { ...s.matchCounts };
      delete nextCounts[id];
      saveWatchCounts(nextCounts);
      return { watchItems: next, matchCounts: nextCounts };
    });
  },

  /**
   * Clear all watch items.
   */
  clearAll: () => {
    saveWatchlist([]);
    saveWatchCounts({});
    set({ watchItems: [], matchCounts: {}, notifications: [] });
  },

  /**
   * Check articles against watchlist items and update counts.
   * Generates notifications for new matches.
   * Called when liveNews data changes.
   *
   * @param {Array} articles - Current articles/events
   */
  checkNewArticles: (articles) => {
    const { watchItems, matchCounts: prevCounts } = get();
    if (!watchItems.length || !articles?.length) return;

    const currentCounts = countMatchesForWatchItems(articles, watchItems);
    const newMatches = computeNewMatches(currentCounts, prevCounts, watchItems);

    const notifications = newMatches.map((match) => ({
      ...match,
      timestamp: Date.now(),
    }));

    saveWatchCounts(currentCounts);
    set({ matchCounts: currentCounts, notifications });
  },

  /**
   * Clear all pending notifications.
   */
  clearNotifications: () => set({ notifications: [] }),

  /**
   * Get total count of new notification items.
   */
  getNotificationCount: () => {
    return get().notifications.reduce((sum, n) => sum + n.newCount, 0);
  },
}));

export default useWatchStore;
