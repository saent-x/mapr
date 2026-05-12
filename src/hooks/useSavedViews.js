import { useCallback, useMemo } from 'react';
import { id } from '@instantdb/react';
import db from '../services/instantDb';
import { storyMatchesFilters } from '../utils/storyFilters';
import { resolveDateFloor } from '../utils/mockData';
import { getRelatedEvents } from '../utils/entityGraph';
import { getUserOwnerRef, getUserOwnerWhere } from '../utils/instantUser';

/**
 * Hook for managing saved filter views via InstantDB.
 *
 * Provides:
 *   views      — array of saved view objects (with computed match counts)
 *   isLoading  — whether the query is still loading
 *   error      — query error, if any
 *   needsAuth  — true when user is not authenticated
 *   user       — current InstantDB user (null if not logged in)
 *   saveView   — persist a new view to InstantDB
 *   deleteView — remove a view from InstantDB
 */
export default function useSavedViews(activeNews = []) {
  const auth = db.useAuth();
  const user = auth.user;
  const needsAuth = !auth.isLoading && !user;

  // Query savedViews for the current user. Pass null when not logged in to skip.
  const { data, isLoading: queryLoading, error } = db.useQuery(
    user
      ? {
          savedViews: {
            $: {
              where: getUserOwnerWhere(user),
            },
          },
        }
      : null,
  );

  const views = useMemo(() => {
    if (!data?.savedViews) return [];
    return data.savedViews.map((v) => {
      const filters = v.filterState || {};
      const filterParams = {
        minSeverity: filters.minSeverity ?? 0,
        minConfidence: filters.minConfidence ?? 0,
        dateFloor: filters.dateWindow ? resolveDateFloor(filters.dateWindow) : null,
        accuracyMode: filters.accuracyMode ?? 'standard',
        verificationFilter: filters.verificationFilter ?? 'all',
        sourceTypeFilter: filters.sourceTypeFilter ?? 'all',
        languageFilter: filters.languageFilter ?? 'all',
        precisionFilter: filters.precisionFilter ?? 'all',
        hideAmplified: filters.hideAmplified ?? false,
      };

      // Filter by filterParams first, then further narrow by entityFilter if present
      let matched = activeNews.filter((s) => storyMatchesFilters(s, filterParams));
      if (filters.entityFilter) {
        const entityMatchedIds = new Set(
          getRelatedEvents(matched, filters.entityFilter.name, filters.entityFilter.type).map((e) => e.id),
        );
        matched = matched.filter((s) => entityMatchedIds.has(s.id));
      }
      const matchCount = matched.length;

      return {
        id: v.id,
        name: v.name,
        description: v.description || '',
        tags: Array.isArray(v.tags) ? v.tags : [],
        pinned: Boolean(v.pinned),
        filters,
        mapState: v.mapState || {},
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
        lastOpenedAt: v.lastOpenedAt || null,
        matchCount,
      };
    }).sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.lastOpenedAt || b.updatedAt || b.createdAt || 0) - (a.lastOpenedAt || a.updatedAt || a.createdAt || 0);
    });
  }, [data, activeNews]);

  const saveView = useCallback(
    async (name, filterState, mapState = {}, options = {}) => {
      if (!user) throw new Error('Must be authenticated to save a view');
      const now = Date.now();
      const viewId = id();
      await db.transact(
        db.tx.savedViews[viewId]
          .update({
            name,
            description: options.description || '',
            tags: Array.isArray(options.tags) ? options.tags : [],
            pinned: Boolean(options.pinned),
            filterState,
            mapState,
            createdAt: now,
            updatedAt: now,
            lastOpenedAt: now,
          })
          .link({ owner: getUserOwnerRef(user) }),
      );
      return viewId;
    },
    [user],
  );

  const deleteView = useCallback(
    async (viewId) => {
      if (!user) throw new Error('Must be authenticated to delete a view');
      await db.transact(db.tx.savedViews[viewId].delete());
    },
    [user],
  );

  const updateView = useCallback(
    async (viewId, updates) => {
      if (!user) throw new Error('Must be authenticated to update a view');
      const patch = { updatedAt: Date.now() };
      if (updates.name !== undefined) patch.name = updates.name;
      if (updates.description !== undefined) patch.description = updates.description;
      if (updates.tags !== undefined) patch.tags = Array.isArray(updates.tags) ? updates.tags : [];
      if (updates.pinned !== undefined) patch.pinned = Boolean(updates.pinned);
      if (updates.lastOpenedAt !== undefined) patch.lastOpenedAt = updates.lastOpenedAt;
      await db.transact(db.tx.savedViews[viewId].update(patch));
    },
    [user],
  );

  const duplicateView = useCallback(
    async (view, name = `${view.name} copy`) => {
      if (!user) throw new Error('Must be authenticated to duplicate a view');
      return saveView(name, view.filters || {}, view.mapState || {}, {
        description: view.description,
        tags: view.tags,
        pinned: false,
      });
    },
    [saveView, user],
  );

  return {
    views,
    isLoading: auth.isLoading || queryLoading,
    error,
    needsAuth,
    user,
    saveView,
    deleteView,
    updateView,
    duplicateView,
  };
}
