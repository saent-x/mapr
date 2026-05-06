import { useCallback, useMemo, useRef } from 'react';
import db from '../services/instantDb';
import { storyMatchesFilters } from '../utils/storyFilters';
import { resolveDateFloor } from '../utils/mockData';
import { getSeverityMeta } from '../utils/mockData';

/**
 * Hook for managing alert rules via InstantDB.
 *
 * Provides:
 *   rules        — array of alert rule objects (with computed match counts)
 *   isLoading    — whether the query is still loading
 *   error        — query error, if any
 *   needsAuth    — true when user is not authenticated
 *   user         — current InstantDB user (null if not logged in)
 *   createRule   — persist a new alert rule to InstantDB
 *   editRule     — update an existing alert rule
 *   deleteRule   — remove an alert rule from InstantDB
 *   toggleActive — toggle an alert rule's active state
 *   newMatches   — array of { rule, articles } for new matches since last check
 *
 * @param {Array} savedViews — current saved views array (to look up filter state)
 * @param {Array} activeNews — current filtered articles array
 */
export default function useAlertRules(savedViews = [], activeNews = []) {
  const auth = db.useAuth();
  const user = auth.user;
  const needsAuth = !auth.isLoading && !user;

  // Query alertRules for the current user. Pass null when not logged in to skip.
  const { data, isLoading: queryLoading, error } = db.useQuery(
    user
      ? {
          alertRules: {
            $: {
              where: {
                owner: user.id,
              },
            },
          },
        }
      : null,
  );

  // Track previously matched article IDs per rule to detect new matches
  const prevMatchesRef = useRef({});

  const rules = useMemo(() => {
    if (!data?.alertRules) return [];

    // Build a lookup of saved views by ID for fast filter state access
    const viewsById = {};
    for (const v of savedViews) {
      viewsById[v.id] = v;
    }

    return data.alertRules.map((r) => {
      const view = viewsById[r.savedViewId];
      const filters = view?.filters || {};
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

      // Match articles: pass view filters AND meet severity threshold
      const threshold = r.severityThreshold ?? 0;
      const matchingArticles = activeNews.filter(
        (s) => storyMatchesFilters(s, filterParams) && (s.severity ?? 0) >= threshold,
      );

      const matchCount = matchingArticles.length;

      // Detect new matches since last check
      const prevIds = prevMatchesRef.current[r.id] || new Set();
      const currentIds = new Set(matchingArticles.map((a) => a.id));
      const newMatchIds = [...currentIds].filter((id) => !prevIds.has(id));

      // Update ref for next check
      prevMatchesRef.current[r.id] = currentIds;

      const severityMeta = getSeverityMeta(threshold);
      const viewName = view?.name || r.savedViewId;

      return {
        id: r.id,
        name: r.name,
        severityThreshold: threshold,
        severityLabel: severityMeta?.label || 'ANY',
        savedViewId: r.savedViewId,
        savedViewName: viewName,
        active: r.active !== false, // default true if undefined
        createdAt: r.createdAt,
        matchCount,
        matchingArticles,
        newMatchArticles: matchingArticles.filter((a) => newMatchIds.includes(a.id)),
      };
    });
  }, [data, savedViews, activeNews]);

  const createRule = useCallback(
    async (name, severityThreshold, savedViewId) => {
      if (!user) throw new Error('Must be authenticated to create an alert rule');
      const now = Date.now();
      const ruleId = `ar-${name}-${now}`;
      await db.transact(
        db.tx.alertRules[ruleId]
          .update({
            name,
            severityThreshold,
            savedViewId,
            active: true,
            createdAt: now,
          })
          .link({ owner: user.id }),
      );
      // Initialize tracking ref for new rule
      prevMatchesRef.current[ruleId] = new Set();
      return ruleId;
    },
    [user],
  );

  const editRule = useCallback(
    async (ruleId, updates) => {
      if (!user) throw new Error('Must be authenticated to edit an alert rule');
      const patch = {};
      if (updates.name !== undefined) patch.name = updates.name;
      if (updates.severityThreshold !== undefined) patch.severityThreshold = updates.severityThreshold;
      if (updates.active !== undefined) patch.active = updates.active;
      await db.transact(db.tx.alertRules[ruleId].update(patch));
    },
    [user],
  );

  const deleteRule = useCallback(
    async (ruleId) => {
      if (!user) throw new Error('Must be authenticated to delete an alert rule');
      await db.transact(db.tx.alertRules[ruleId].delete());
      // Clean up tracking ref
      delete prevMatchesRef.current[ruleId];
    },
    [user],
  );

  const toggleActive = useCallback(
    async (rule) => {
      if (!user) throw new Error('Must be authenticated to toggle alert rule');
      const newActive = !rule.active;
      await db.transact(
        db.tx.alertRules[rule.id].update({ active: newActive }),
      );
    },
    [user],
  );

  return {
    rules,
    isLoading: auth.isLoading || queryLoading,
    error,
    needsAuth,
    user,
    createRule,
    editRule,
    deleteRule,
    toggleActive,
  };
}
