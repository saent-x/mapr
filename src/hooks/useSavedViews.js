import { useCallback, useMemo } from 'react';
import db from '../services/instantDb';
import { storyMatchesFilters } from '../utils/storyFilters';
import { resolveDateFloor } from '../utils/mockData';
import { getRelatedEvents } from '../utils/entityGraph';

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
              where: {
                owner: user.id,
              },
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
        filters,
        mapState: v.mapState || {},
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
        matchCount,
      };
    });
  }, [data, activeNews]);

  const saveView = useCallback(
    async (name, filterState, mapState = {}) => {
      if (!user) throw new Error('Must be authenticated to save a view');
      const now = Date.now();
      const viewId = `${name}-${now}`; // simple unique id
      await db.transact(
        db.tx.savedViews[viewId]
          .update({
            name,
            filterState,
            mapState,
            createdAt: now,
            updatedAt: now,
          })
          .link({ owner: user.id }),
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

  return {
    views,
    isLoading: auth.isLoading || queryLoading,
    error,
    needsAuth,
    user,
    saveView,
    deleteView,
  };
}
