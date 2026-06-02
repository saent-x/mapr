import { query } from "./_generated/server";
import { v } from "convex/values";
import { computeRegions, computeAnomalies, type EventLike, type Tier } from "./lib/intent";

const SCAN_LIMIT = 2000;

/** Deterministic situation overview (for /intel): tiers, hotspots, anomalies, top events. */
export const overview = query({
  args: { windowHours: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? 24;
    const now = Date.now();
    const windowMs = windowHours * 3_600_000;
    // Scan 2x the window so anomaly baselines have a prior period.
    const events = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", now - 2 * windowMs))
      .order("desc")
      .take(SCAN_LIMIT);

    const like: EventLike[] = events.map((e) => ({
      id: String(e._id),
      isoA2: e.isoA2,
      tier: e.tier as Tier,
      severity: e.severity,
      category: e.category,
      publishedAt: e.publishedAt,
      title: e.title,
      summary: e.summary,
      source: e.source,
    }));
    const inWindow = events.filter((e) => now - e.publishedAt <= windowMs);
    const tierCounts = { green: 0, amber: 0, red: 0, black: 0 };
    for (const e of inWindow) tierCounts[e.tier]++;

    return {
      windowHours,
      total: inWindow.length,
      tierCounts,
      regions: computeRegions(like.filter((e) => now - e.publishedAt <= windowMs), 6),
      anomalies: computeAnomalies(like, windowMs, now, 8),
      topEvents: [...inWindow]
        .sort((a, b) => b.severity - a.severity)
        .slice(0, 8)
        .map((e) => ({
          id: e._id,
          title: e.title,
          tier: e.tier,
          severity: e.severity,
          category: e.category,
          isoA2: e.isoA2,
          publishedAt: e.publishedAt,
        })),
    };
  },
});
