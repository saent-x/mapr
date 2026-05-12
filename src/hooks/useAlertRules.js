import { useCallback, useEffect, useMemo, useRef } from 'react';
import { id } from '@instantdb/react';
import db from '../services/instantDb';
import { storyMatchesFilters } from '../utils/storyFilters';
import { resolveDateFloor } from '../utils/mockData';
import { getSeverityMeta } from '../utils/mockData';
import { getUserOwnerRef, getUserOwnerWhere } from '../utils/instantUser';

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
              where: getUserOwnerWhere(user),
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
      const confidenceThreshold = r.minConfidence ?? filters.minConfidence ?? 0;
      const premiumFilterParams = {
        ...filterParams,
        minConfidence: Math.max(filterParams.minConfidence || 0, confidenceThreshold),
      };
      const matchingArticles = activeNews.filter(
        (s) => storyMatchesFilters(s, premiumFilterParams) && (s.severity ?? 0) >= threshold,
      );

      const matchCount = matchingArticles.length;

      // Detect new matches since last check.
      // IMPORTANT: useMemo callbacks must be pure — do NOT mutate the ref
      // here. StrictMode double-invokes memo callbacks in dev, and the old
      // pattern (mutating prevMatchesRef inside useMemo) caused the "skip
      // already toasted" guard to be silently bypassed because the second
      // invocation overwrote the snapshot before the effect could read it.
      // We only READ here; the WRITE happens in the useEffect below.
      const prevIds = prevMatchesRef.current[r.id] || new Set();
      const newMatchIds = matchingArticles
        .map((a) => a.id)
        .filter((id) => !prevIds.has(id));

      const severityMeta = getSeverityMeta(threshold);
      const viewName = view?.name || r.savedViewId;

      return {
        id: r.id,
        name: r.name,
        severityThreshold: threshold,
        minConfidence: confidenceThreshold,
        severityLabel: severityMeta?.label || 'ANY',
        savedViewId: r.savedViewId,
        savedViewName: viewName,
        deliveryMode: r.deliveryMode || 'instant',
        quietHours: r.quietHours || { enabled: false, start: '22:00', end: '07:00' },
        channels: r.channels || { inApp: true, email: false, digest: false },
        lastTriggeredAt: r.lastTriggeredAt || null,
        active: r.active !== false, // default true if undefined
        createdAt: r.createdAt,
        matchCount,
        matchingArticles,
        newMatchArticles: matchingArticles.filter((a) => newMatchIds.includes(a.id)),
      };
    });
  }, [data, savedViews, activeNews]);

  // Snapshot the current match-ID set per rule AFTER render commits, so the
  // next render's useMemo can compute a correct diff. Decoupled from the memo
  // body to keep that pure (see comment above).
  useEffect(() => {
    for (const rule of rules) {
      prevMatchesRef.current[rule.id] = new Set(
        rule.matchingArticles.map((a) => a.id),
      );
    }
  }, [rules]);

  const createRule = useCallback(
    async (name, severityThreshold, savedViewId, options = {}) => {
      if (!user) throw new Error('Must be authenticated to create an alert rule');
      const now = Date.now();
      const ruleId = id();
      await db.transact(
        db.tx.alertRules[ruleId]
          .update({
            name,
            severityThreshold,
            minConfidence: options.minConfidence ?? 0,
            deliveryMode: options.deliveryMode || 'instant',
            quietHours: options.quietHours || { enabled: false, start: '22:00', end: '07:00' },
            channels: options.channels || { inApp: true, email: false, digest: false },
            lastTriggeredAt: null,
            savedViewId,
            active: true,
            createdAt: now,
          })
          .link({ owner: getUserOwnerRef(user) }),
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
      if (updates.minConfidence !== undefined) patch.minConfidence = updates.minConfidence;
      if (updates.deliveryMode !== undefined) patch.deliveryMode = updates.deliveryMode;
      if (updates.quietHours !== undefined) patch.quietHours = updates.quietHours;
      if (updates.channels !== undefined) patch.channels = updates.channels;
      if (updates.lastTriggeredAt !== undefined) patch.lastTriggeredAt = updates.lastTriggeredAt;
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
