import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  parseQuery,
  interpret,
  type EventLike,
  type Tier,
} from "./lib/intent";

export const DEFAULT_WINDOW_HOURS = 168;
const FEED_LIMIT = 600;
const RECENT_SCAN_LIMIT = 2000;

function toEventLike(d: Doc<"events">): EventLike {
  return {
    id: d._id,
    isoA2: d.isoA2,
    tier: d.tier as Tier,
    severity: d.severity,
    category: d.category,
    publishedAt: d.publishedAt,
    title: d.title,
    summary: d.summary,
    source: d.source,
  };
}

/**
 * The live event feed that drives the map markers. Reactive: new ingested
 * events appear without polling. Defaults to the trailing 7d window.
 */
export const list = query({
  args: {
    windowHours: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? DEFAULT_WINDOW_HOURS;
    const limit = Math.min(args.limit ?? FEED_LIMIT, FEED_LIMIT);
    const cutoff = Date.now() - windowHours * 3_600_000;
    const rows = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
      .order("desc")
      .take(limit);
    return rows;
  },
});

/**
 * Per-region coverage rollup over the window (ALL events, not the feed cap) —
 * drives the choropleth so every country with activity is tinted, even when its
 * events fall outside the recency-capped feed.
 */
export const regionCoverage = query({
  args: { windowHours: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? DEFAULT_WINDOW_HOURS;
    const cutoff = Date.now() - windowHours * 3_600_000;
    const rows = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
      .order("desc")
      .take(RECENT_SCAN_LIMIT);
    const byIso = new Map<string, { count: number; maxSev: number; tier: Doc<"events">["tier"] }>();
    for (const e of rows) {
      if (!e.isoA2) continue;
      const cur = byIso.get(e.isoA2) ?? { count: 0, maxSev: -1, tier: "green" as Doc<"events">["tier"] };
      cur.count += 1;
      if (e.severity > cur.maxSev) {
        cur.maxSev = e.severity;
        cur.tier = e.tier;
      }
      byIso.set(e.isoA2, cur);
    }
    return [...byIso.entries()].map(([iso, v]) => ({ iso, count: v.count, maxSev: v.maxSev, tier: v.tier }));
  },
});

export const get = query({
  args: { id: v.id("events") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

export const byIds = query({
  args: { ids: v.array(v.id("events")) },
  handler: async (ctx, args) => {
    const docs = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    return docs.filter((d): d is Doc<"events"> => d !== null);
  },
});

/** Full event detail + its contributing articles (for /event/:id). */
export const detail = query({
  args: { id: v.id("events") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.id);
    if (!event) return null;
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", args.id))
      .take(50);
    articles.sort((a, b) => b.publishedAt - a.publishedAt);
    return {
      event,
      articles: articles.map((a) => ({
        id: a._id,
        title: a.title,
        summary: a.summary,
        source: a.source,
        url: a.url ?? null,
        publishedAt: a.publishedAt,
        tier: a.tier,
        severity: a.severity,
      })),
    };
  },
});

/**
 * Deterministic composer path: parse a natural-language query, filter the
 * feed, and return the events to plot + a grounded reply. NO LLM — instant and
 * offline. Free-form questions go to the RAG QA action instead.
 */
export const intentSearch = query({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const p = parseQuery(args.text);
    const activeWindowMs = (p.win ? p.win.hrs : DEFAULT_WINDOW_HOURS) * 3_600_000;
    // Pull 2x the active window so anomaly baselines have a prior period.
    const scanCutoff = now - 2 * activeWindowMs;
    const rows = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", scanCutoff))
      .order("desc")
      .take(RECENT_SCAN_LIMIT);

    const recent = rows.map(toEventLike);
    const result = interpret(p, recent, DEFAULT_WINDOW_HOURS * 3_600_000, now);

    const byId = new Map(rows.map((r) => [String(r._id), r]));
    const topEvents = result.topEventIds
      .map((id) => byId.get(id))
      .filter((d): d is Doc<"events"> => d !== undefined);

    // Grounded facets of the FULL matched set — drives the result chart (real
    // counts from the data, never model-generated numbers).
    const matched = (result.eventIds ?? [])
      .map((id) => byId.get(id))
      .filter((d): d is Doc<"events"> => d !== undefined);
    const tierCounts: Record<string, number> = { green: 0, amber: 0, red: 0, black: 0 };
    const regionCounts = new Map<string, number>();
    for (const d of matched) {
      tierCounts[d.tier] = (tierCounts[d.tier] ?? 0) + 1;
      if (d.isoA2) regionCounts.set(d.isoA2, (regionCounts.get(d.isoA2) ?? 0) + 1);
    }
    const facetRegions = [...regionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([iso, count]) => ({ iso, count }));
    const facets =
      matched.length >= 3 ? { total: matched.length, tiers: tierCounts, regions: facetRegions } : null;

    return {
      intent: result.intent,
      route: result.route,
      reply: result.reply,
      scope: result.scope,
      matchCount: result.matchCount,
      totalScanned: rows.length,
      // undefined => leave the map unchanged (context pivot like "what's spiking")
      eventIds: result.eventIds,
      topEvents,
      regions: result.regions ?? null,
      anomalies: result.anomalies ?? null,
      facets,
    };
  },
});
