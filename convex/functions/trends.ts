import { query } from "./_generated/server";
import { v } from "convex/values";
import { regionName } from "./lib/regions";

const SCAN_LIMIT = 3000;

/** Time-bucketed activity series + top categories/regions (for /trends). */
export const series = query({
  args: { windowHours: v.optional(v.number()), buckets: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? 168;
    const nBuckets = Math.max(6, Math.min(96, args.buckets ?? 24));
    const now = Date.now();
    const cutoff = now - windowHours * 3_600_000;
    const bucketMs = (windowHours * 3_600_000) / nBuckets;

    const events = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
      .take(SCAN_LIMIT);

    const buckets = Array.from({ length: nBuckets }, (_, i) => ({
      t: Math.round(cutoff + i * bucketMs),
      total: 0,
      green: 0,
      amber: 0,
      red: 0,
      black: 0,
    }));
    const byCategory = new Map<string, number>();
    const byRegion = new Map<string, number>();
    for (const e of events) {
      const idx = Math.min(nBuckets - 1, Math.max(0, Math.floor((e.publishedAt - cutoff) / bucketMs)));
      buckets[idx].total++;
      buckets[idx][e.tier]++;
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);
      if (e.isoA2) byRegion.set(e.isoA2, (byRegion.get(e.isoA2) ?? 0) + 1);
    }

    return {
      buckets,
      bucketMs,
      windowHours,
      total: events.length,
      topCategories: [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, count]) => ({ key, count })),
      topRegions: [...byRegion.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([iso, count]) => ({ iso, name: regionName(iso), count })),
    };
  },
});
