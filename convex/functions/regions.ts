import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { regionName } from "./lib/regions";
import { summarizeSources } from "./lib/sourceConfidence";

const DEFAULT_WINDOW_HOURS = 168;

/** Region dossier (for /region/:iso): rollup stats + top events in the window. */
export const dossier = query({
  args: { iso: v.string(), windowHours: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? DEFAULT_WINDOW_HOURS;
    const cutoff = Date.now() - windowHours * 3_600_000;
    const events = await ctx.db
      .query("events")
      .withIndex("by_iso", (q) => q.eq("isoA2", args.iso).gte("publishedAt", cutoff))
      .order("desc")
      .take(300);

    const tierCounts = { green: 0, amber: 0, red: 0, black: 0 };
    let sevSum = 0;
    for (const e of events) {
      tierCounts[e.tier]++;
      sevSum += e.severity;
    }
    const byCategory = new Map<string, number>();
    for (const e of events) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);

    const topEntities = new Map<string, number>();
    for (const e of events) for (const entity of e.entities ?? []) topEntities.set(entity, (topEntities.get(entity) ?? 0) + 1);
    const sourceRows = events.map((e) => ({ source: e.source, publishedAt: e.publishedAt }));
    const top = [...events].sort((a, b) => b.severity - a.severity || b.publishedAt - a.publishedAt).slice(0, 16);
    return {
      iso: args.iso,
      name: regionName(args.iso),
      eventCount: events.length,
      avgSeverity: events.length ? sevSum / events.length : 0,
      tierCounts,
      categories: [...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count })),
      sourceConfidence: summarizeSources(sourceRows),
      topEntities: [...topEntities.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([entity, count]) => ({ entity, count })),
      events: top.map((e: Doc<"events">) => ({
        id: e._id,
        title: e.title,
        summary: e.summary,
        tier: e.tier,
        severity: e.severity,
        category: e.category,
        source: e.source,
        url: e.url ?? null,
        publishedAt: e.publishedAt,
        lon: e.lon,
        lat: e.lat,
      })),
    };
  },
});
