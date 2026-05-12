import { useCallback, useMemo, useState } from 'react';
import { id } from '@instantdb/react';
import db from '../services/instantDb';
import { getUserOwnerRef, getUserOwnerWhere } from '../utils/instantUser';

/**
 * Hook for managing story bookmarks via InstantDB.
 *
 * Provides:
 *   bookmarks         — array of bookmark objects with story data
 *   isLoading         — whether the query is still loading
 *   error             — query error, if any
 *   needsAuth         — true when user is not authenticated
 *   user              — current InstantDB user (null if not logged in)
 *   toggleBookmark    — add or remove a bookmark for a story
 *   isBookmarked      — check if a story ID is currently bookmarked
 *
 * Filter state (kept in hook for simplicity):
 *   filterRegion      — filter bookmarks by region ISO code
 *   setFilterRegion   — set the region filter
 *   filterMinSeverity — minimum severity threshold
 *   setFilterMinSeverity — set the severity filter
 *   filterDateFrom    — show bookmarks after this date
 *   setFilterDateFrom — set the date-from filter
 *   filterDateTo      — show bookmarks before this date
 *   setFilterDateTo   — set the date-to filter
 *   filteredBookmarks — bookmarks after applying all filters
 */
export default function useBookmarks() {
  const auth = db.useAuth();
  const user = auth.user;
  const needsAuth = !auth.isLoading && !user;

  // Filter state
  const [filterRegion, setFilterRegion] = useState('');
  const [filterMinSeverity, setFilterMinSeverity] = useState(0);
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');

  // Query bookmarks for the current user. Pass null when not logged in to skip.
  const { data, isLoading: queryLoading, error } = db.useQuery(
    user
      ? {
          bookmarks: {
            $: {
              where: getUserOwnerWhere(user),
            },
          },
        }
      : null,
  );

  const bookmarks = useMemo(() => {
    if (!data?.bookmarks) return [];
    return data.bookmarks.map((b) => ({
      id: b.id,
      storyId: b.storyId,
      storyTitle: b.storyTitle,
      storySummary: b.storySummary || '',
      source: b.source || '',
      url: b.url || '',
      note: b.note || '',
      tags: Array.isArray(b.tags) ? b.tags : [],
      status: b.status || 'unread',
      priority: b.priority || 'normal',
      region: b.region || '',
      severity: b.severity ?? 0,
      bookmarkedAt: b.bookmarkedAt,
      updatedAt: b.updatedAt || b.bookmarkedAt,
    }));
  }, [data]);

  const bookmarkSet = useMemo(() => {
    const s = new Set();
    for (const b of bookmarks) {
      s.add(b.storyId);
    }
    return s;
  }, [bookmarks]);

  const filteredBookmarks = useMemo(() => {
    let result = bookmarks;

    if (filterRegion) {
      const regionUpper = filterRegion.toUpperCase();
      result = result.filter((b) => b.region === regionUpper);
    }

    if (filterMinSeverity > 0) {
      result = result.filter((b) => b.severity >= filterMinSeverity);
    }

    if (filterDateFrom) {
      const fromTs = new Date(filterDateFrom).getTime();
      if (!Number.isNaN(fromTs)) {
        result = result.filter((b) => b.bookmarkedAt >= fromTs);
      }
    }

    if (filterDateTo) {
      const toTs = new Date(filterDateTo).getTime();
      if (!Number.isNaN(toTs)) {
        // End of day for the "to" date
        const endOfDay = toTs + 24 * 60 * 60 * 1000 - 1;
        result = result.filter((b) => b.bookmarkedAt <= endOfDay);
      }
    }

    if (filterStatus !== 'all') {
      result = result.filter((b) => b.status === filterStatus);
    }

    if (filterPriority !== 'all') {
      result = result.filter((b) => b.priority === filterPriority);
    }

    return result;
  }, [bookmarks, filterRegion, filterMinSeverity, filterDateFrom, filterDateTo, filterStatus, filterPriority]);

  const isBookmarked = useCallback(
    (storyId) => bookmarkSet.has(storyId),
    [bookmarkSet],
  );

  const toggleBookmark = useCallback(
    async (story) => {
      if (!user) throw new Error('Must be authenticated to bookmark');
      if (!story || !story.id) throw new Error('Story must have an id');

      const existing = bookmarks.find((b) => b.storyId === story.id);

      if (existing) {
        // Remove bookmark
        await db.transact(db.tx.bookmarks[existing.id].delete());
      } else {
        // Add bookmark
        const now = Date.now();
        const bmId = id();
        await db.transact(
          db.tx.bookmarks[bmId]
            .update({
              storyId: story.id,
              storyTitle: story.title || 'Untitled',
              storySummary: story.summary || '',
              source: story.source || '',
              url: story.url || '',
              note: '',
              tags: Array.isArray(story.tags) ? story.tags : [],
              status: 'unread',
              priority: story.severity >= 70 ? 'high' : 'normal',
              region: story.isoA2 || story.region || '',
              severity: story.severity ?? 0,
              bookmarkedAt: now,
              updatedAt: now,
            })
            .link({ owner: getUserOwnerRef(user) }),
        );
      }
    },
    [user, bookmarks],
  );

  const updateBookmark = useCallback(
    async (bookmarkId, updates) => {
      if (!user) throw new Error('Must be authenticated to update bookmark');
      const patch = { updatedAt: Date.now() };
      if (updates.note !== undefined) patch.note = updates.note;
      if (updates.tags !== undefined) patch.tags = Array.isArray(updates.tags) ? updates.tags : [];
      if (updates.status !== undefined) patch.status = updates.status;
      if (updates.priority !== undefined) patch.priority = updates.priority;
      await db.transact(db.tx.bookmarks[bookmarkId].update(patch));
    },
    [user],
  );

  return {
    bookmarks,
    filteredBookmarks,
    isLoading: auth.isLoading || queryLoading,
    error,
    needsAuth,
    user,
    isBookmarked,
    toggleBookmark,
    updateBookmark,
    // Filters
    filterRegion,
    setFilterRegion,
    filterMinSeverity,
    setFilterMinSeverity,
    filterDateFrom,
    setFilterDateFrom,
    filterDateTo,
    setFilterDateTo,
    filterStatus,
    setFilterStatus,
    filterPriority,
    setFilterPriority,
  };
}
