import { query } from "./_generated/server";
import { v } from "convex/values";

const SCAN_LIMIT = 1500;
const SEP = "\u0000";

/** Entity co-occurrence graph (for /entities): nodes = entities, edges = shared events. */
export const graph = query({
  args: { windowHours: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? 168;
    const limit = Math.max(10, Math.min(80, args.limit ?? 40));
    const cutoff = Date.now() - windowHours * 3_600_000;

    const events = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
      .take(SCAN_LIMIT);

    const nodeStat = new Map<string, { count: number; severity: number }>();
    const edgeCount = new Map<string, number>();
    for (const e of events) {
      const ents = (e.entities ?? []).slice(0, 8);
      for (const ent of ents) {
        const n = nodeStat.get(ent) ?? { count: 0, severity: 0 };
        n.count++;
        n.severity = Math.max(n.severity, e.severity);
        nodeStat.set(ent, n);
      }
      for (let i = 0; i < ents.length; i++) {
        for (let j = i + 1; j < ents.length; j++) {
          const key = [ents[i], ents[j]].sort().join(SEP);
          edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
        }
      }
    }

    const nodes = [...nodeStat.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([id, s]) => ({ id, count: s.count, severity: s.severity }));
    const keep = new Set(nodes.map((n) => n.id));
    const edges = [...edgeCount.entries()]
      .map(([k, weight]) => {
        const [source, target] = k.split(SEP);
        return { source, target, weight };
      })
      .filter((e) => keep.has(e.source) && keep.has(e.target))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 140);

    return { nodes, edges, total: events.length };
  },
});

export const dossier = query({
  args: { entity: v.string(), windowHours: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? 168;
    const cutoff = Date.now() - windowHours * 3_600_000;
    const rows = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
      .order("desc")
      .take(SCAN_LIMIT);
    const entity = args.entity.toLowerCase();
    const events = rows.filter((e) => (e.entities ?? []).some((x) => x.toLowerCase() === entity));
    const regions = new Map<string, number>();
    const related = new Map<string, number>();
    let maxSeverity = 0;
    for (const e of events) {
      maxSeverity = Math.max(maxSeverity, e.severity);
      if (e.isoA2) regions.set(e.isoA2, (regions.get(e.isoA2) ?? 0) + 1);
      for (const ent of e.entities ?? []) {
        if (ent.toLowerCase() !== entity) related.set(ent, (related.get(ent) ?? 0) + 1);
      }
    }
    return {
      entity: args.entity,
      eventCount: events.length,
      maxSeverity,
      regions: [...regions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([iso, count]) => ({ iso, count })),
      related: [...related.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count })),
      events: events.slice(0, 20).map((e) => ({
        id: e._id,
        title: e.title,
        summary: e.summary,
        isoA2: e.isoA2,
        tier: e.tier,
        severity: e.severity,
        category: e.category,
        publishedAt: e.publishedAt,
      })),
    };
  },
});
