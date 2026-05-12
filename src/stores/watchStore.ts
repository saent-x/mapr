import { create } from 'zustand';
import {
  loadWatchlist,
  saveWatchlist,
  loadWatchCounts,
  saveWatchCounts,
  loadWatchTimestamps,
  saveWatchTimestamps,
  countMatchesForWatchItems,
  computeNewMatches,
} from '../utils/watchUtils.js';
import type { WatchState, WatchItem, WatchItemType } from '../types/store';
import type { Article } from '../types/api';

/**
 * Watch store — manages the watchlist (regions, topics, entities,
 * categories, severity thresholds, source types, verification statuses),
 * article match counts, last-match timestamps, and new-match notifications.
 *
 * Watchlist items, counts, and timestamps persist in localStorage across sessions.
 */
const useWatchStore = create<WatchState>()((set, get) => ({
  /* ── state ── */
  watchItems: typeof window !== 'undefined' ? loadWatchlist() : [],
  matchCounts: (typeof window !== 'undefined' ? loadWatchCounts() : {}) as Record<string, number>,
  lastMatchTimestamps: (typeof window !== 'undefined' ? loadWatchTimestamps() : {}) as Record<string, number>,
  notifications: [], // Array of { watchId, label, type, newCount, totalCount, timestamp }

  /* ────────── actions ────────── */

  /**
   * Add a new watch item. Store mints the id — callers must not pass one.
   * @param type - watchlist rule type
   * @param value - ISO code, keyword, category name, severity tier, source type, or verification status
   * @param label - Human-readable label (defaults to value)
   */
  addWatch: (type: WatchItemType, value: string, label?: string) => {
    if (!type || !value?.trim()) return;
    const normalizedValue = value.trim();
    const existing = get().watchItems;

    if (existing.some((item) => item.type === type && item.value.toLowerCase() === normalizedValue.toLowerCase())) {
      return;
    }

    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `w-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const newItem: WatchItem = {
      id,
      type,
      value: normalizedValue,
      label: label?.trim() || normalizedValue,
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
   */
  removeWatch: (id: string) => {
    set((s) => {
      const next = s.watchItems.filter((item) => item.id !== id);
      saveWatchlist(next);
      // Also clean up counts and timestamps
      const nextCounts = { ...s.matchCounts };
      delete nextCounts[id];
      saveWatchCounts(nextCounts);
      const nextTimestamps = { ...s.lastMatchTimestamps };
      delete nextTimestamps[id];
      saveWatchTimestamps(nextTimestamps);
      return {
        watchItems: next,
        matchCounts: nextCounts,
        lastMatchTimestamps: nextTimestamps,
      };
    });
  },

  /**
   * Clear all watch items.
   */
  clearAll: () => {
    saveWatchlist([]);
    saveWatchCounts({});
    saveWatchTimestamps({});
    set({ watchItems: [], matchCounts: {}, lastMatchTimestamps: {}, notifications: [] });
  },

  /**
   * Check articles against watchlist items and update counts.
   * Generates notifications for new matches.
   * Called when liveNews data changes.
   */
  checkNewArticles: (articles: Article[]) => {
    const { watchItems, matchCounts: prevCounts } = get();
    if (!watchItems.length || !articles?.length) return;

    const result = countMatchesForWatchItems(articles, watchItems) as unknown as { counts: Record<string, number>; timestamps: Record<string, number> };
    const currentCounts = result.counts;
    const currentTimestamps = result.timestamps;
    const newMatches = computeNewMatches(currentCounts, prevCounts, watchItems) as unknown as Array<{ watchId: string; label: string; type: string; newCount: number; totalCount: number }>;

    const notifications = newMatches.map((match: { watchId: string; label: string; type: string; newCount: number; totalCount: number }) => ({
      ...match,
      timestamp: Date.now(),
    }));

    saveWatchCounts(currentCounts);
    saveWatchTimestamps(currentTimestamps);
    set({
      matchCounts: currentCounts,
      lastMatchTimestamps: currentTimestamps,
      notifications,
    });
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
