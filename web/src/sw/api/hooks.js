/* ============================================================
   React data hooks — the Standing Watch UI's binding to the live
   self-hosted Convex backend. Uses anyApi so the web app needs no
   generated-types import. Each hook returns adapted, render-ready data.
   ============================================================ */
import { useMemo } from "react";
import { useQuery, useAction, useMutation, useConvex, useConvexAuth } from "convex/react";
import { anyApi } from "convex/server";
import { adaptEvent, buildInvestigation } from "./adapters.js";

// The deterministic dominant region of the matched set (intent.scope is a
// human string, not structured) — used only as a fallback for the scope chip.
function isoFromScope(intent) {
  const fr = intent?.facets?.regions;
  if (Array.isArray(fr) && fr.length && typeof fr[0].iso === "string" && fr[0].iso.length === 2) return fr[0].iso;
  const te = intent?.topEvents;
  if (Array.isArray(te) && te.length && typeof te[0].isoA2 === "string" && te[0].isoA2.length === 2) return te[0].isoA2;
  return null;
}

// Most frequent ISO across a set of adapted events (the region the cited
// evidence actually clusters in — the most relevant scope for the answer).
function modeIso(events) {
  const counts = {};
  for (const e of events) if (e && e.iso2) counts[e.iso2] = (counts[e.iso2] || 0) + 1;
  let best = null, bestN = 0;
  for (const k in counts) if (counts[k] > bestN) { best = k; bestN = counts[k]; }
  return best;
}

/** Live event feed → adapted map markers. Reactive: new ingests appear live. */
export function useEvents(windowHours = 168) {
  const rows = useQuery(anyApi.events.list, { windowHours });
  const events = useMemo(
    () => (rows ? rows.map(adaptEvent).filter(Boolean) : []),
    [rows],
  );
  return { events, loading: rows === undefined };
}

/** Per-region coverage rollup (choropleth / region counts). */
export function useRegionCoverage(windowHours = 168) {
  const rows = useQuery(anyApi.events.regionCoverage, { windowHours });
  return rows ?? [];
}

/** Deterministic time-bucketed activity series (computed over the owned corpus). */
export function useTrends(windowHours = 168) {
  return useQuery(anyApi.trends.series, { windowHours }); // undefined=loading
}

/** Computed signals = recency-weighted movers (trends.anomalies, public) merged
 *  with the signed-in user's fired watches (watchBaselines.listSignals). */
export function useSignals() {
  const anomalies = useQuery(anyApi.trends.anomalies, { windowHours: 168 });
  const fired = useQuery(anyApi.watchBaselines.listSignals, { limit: 50 });
  return {
    anomalies: anomalies ?? [],
    fired: Array.isArray(fired) ? fired : [],
    loading: anomalies === undefined,
  };
}

/** The active source catalog (Feeds drawer) — public read-only, no secrets. */
export function useFeeds() {
  return useQuery(anyApi.admin.publicSources, {});
}
/** Submit a source request (Pro-gated server-side). */
export function useSourceRequest() {
  return useMutation(anyApi.sourceRequests.submit);
}

/** Canonicalized entity co-occurrence graph (entities.graph, public). */
export function useEntities(windowHours = 168) {
  return useQuery(anyApi.entities.graph, { windowHours, limit: 24 });
}

/** Full entity dossier — co-occurrence + regions + recent linked events. */
export function useDossier(name) {
  return useQuery(anyApi.entities.dossier, name ? { entity: name } : "skip");
}

/** Per-user watches + per-user cases (auth-scoped; [] when signed out). */
export function useWatches() {
  return useQuery(anyApi.watchlist.list, {}) ?? null;
}
export function useCases() {
  return useQuery(anyApi.cases.list, {}) ?? null;
}

/** Standing-watch mutations: create (freezes a baseline) + remove. */
export function useWatchActions() {
  return {
    create: useMutation(anyApi.watchBaselines.createWatchWithBaseline),
    remove: useMutation(anyApi.watchlist.remove),
  };
}
/** The deterministic Baseline Diff Report for one watch (live vs frozen baseline). */
export function useDiffWatch(watchlistItemId) {
  return useQuery(anyApi.watchBaselines.diffWatch, watchlistItemId ? { watchlistItemId } : "skip");
}

/** Case mutations (Pro-gated server-side) + a single case + its items. */
export function useCaseActions() {
  return {
    create: useMutation(anyApi.cases.create),
    addItem: useMutation(anyApi.cases.addItem),
  };
}
export function useCase(id) {
  return useQuery(anyApi.cases.get, id ? { id } : "skip");
}

/** Auth state for gating per-user features (investigate, watches, cases…). */
export function useAuth() {
  return useConvexAuth(); // { isAuthenticated, isLoading }
}

/**
 * The real investigation: deterministic scope/facets (events.intentSearch) +
 * grounded cited generation (rag.ask, qwen over the owned corpus) + evidence
 * enrichment (events.byIds). Returns the investigation-card shape. Requires a
 * signed-in user (rag.ask enforces auth + quota server-side).
 */
export function useInvestigation() {
  const convex = useConvex();
  const ask = useAction(anyApi.rag.ask);
  const { isAuthenticated, isLoading } = useConvexAuth();

  async function run(text, opts = {}) {
    // 1) deterministic scope + computed facets (instant, no LLM)
    let intent = null;
    try {
      intent = await convex.query(anyApi.events.intentSearch, { text });
    } catch (e) {
      /* non-fatal — proceed without facets */
    }
    // Only constrain retrieval when the caller passed an explicit ISO scope
    // (a chip); free-text questions retrieve unconstrained for best recall.
    const explicitRegion = typeof opts.region === "string" && opts.region.length === 2 ? opts.region : null;

    // 2) grounded, cited generation over the owned corpus (qwen2.5:3b)
    const res = await ask({
      text,
      region: explicitRegion || undefined,
      eventIds: opts.eventIds && opts.eventIds.length ? opts.eventIds : undefined,
      windowHours: opts.windowHours,
    });

    // 3) enrich citations with their event (tier/severity/category) for rich rows
    const ids = [...new Set((res.citations || []).map((c) => c.eventId).filter(Boolean))];
    const eventsById = {};
    if (ids.length) {
      try {
        const evs = await convex.query(anyApi.events.byIds, { ids });
        for (const e of evs) eventsById[e._id] = adaptEvent(e);
      } catch (e) {
        /* non-fatal — rows fall back to citation-only data */
      }
    }

    // The scope chip/watch region: the region the CITED evidence clusters in
    // (most relevant to the answer), falling back to the matched-set dominant.
    const regionIso = explicitRegion || modeIso(Object.values(eventsById)) || isoFromScope(intent);
    return buildInvestigation(text, res, eventsById, intent, regionIso);
  }

  return { run, isAuthenticated, isLoading };
}

/** Live QA quota for the signed-in user (free 10 / pro 200 per trailing 30d). */
export function useQuota() {
  return useQuery(anyApi.qa.quotaStatus, {}) ?? null;
}

/** Authenticated user record (role/tier/limits/isPro) — undefined=loading, null=signed out. */
export function useMe() {
  return useQuery(anyApi.users.me, {});
}

/** Real watchdesk counts for the signed-in user (watches · cases · pinned). */
export function useAccountStats() {
  const watches = useQuery(anyApi.watchlist.list, {});
  const cases = useQuery(anyApi.cases.list, {});
  const bookmarks = useQuery(anyApi.bookmarks.list, {});
  return {
    watches: Array.isArray(watches) ? watches.length : 0,
    cases: Array.isArray(cases) ? cases.length : 0,
    pinned: Array.isArray(bookmarks) ? bookmarks.length : 0,
    loading: watches === undefined || cases === undefined || bookmarks === undefined,
  };
}

/** Stripe billing actions (checkout to upgrade, portal to manage). */
export function useBilling() {
  return {
    checkout: useAction(anyApi.billing.createCheckout),
    portal: useAction(anyApi.billing.createPortal),
  };
}

/** Update the user's display name (the only client-writable profile field). */
export function useUpdateProfile() {
  return useMutation(anyApi.users.updateProfile);
}

/* ── Admin (requireAdmin server-side) ── */
export function useAdminHealth(isAdmin) {
  return useQuery(anyApi.admin.health, isAdmin ? {} : "skip");
}
export function useAdminFlags() {
  return useQuery(anyApi.admin.featureFlags, {}); // public-readable
}
export function useAdminRequests(isAdmin) {
  return useQuery(anyApi.sourceRequests.listAdmin, isAdmin ? {} : "skip");
}
export function useAdminActions() {
  return {
    addSource: useMutation(anyApi.admin.addSource),
    setSourceEnabled: useMutation(anyApi.admin.setSourceEnabled),
    removeSource: useMutation(anyApi.admin.removeSource),
    setFeatureFlag: useMutation(anyApi.admin.setFeatureFlag),
    requestRefresh: useMutation(anyApi.admin.requestRefresh),
    reviewRequest: useMutation(anyApi.sourceRequests.review),
  };
}
