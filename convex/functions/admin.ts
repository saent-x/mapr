import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./lib/access";

// ── Source catalog (admin) ──
export const listSources = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("sourceCatalog").order("desc").collect();
  },
});

export const addSource = mutation({
  args: {
    name: v.string(),
    url: v.string(),
    kind: v.union(v.literal("gdelt"), v.literal("rss"), v.literal("html"), v.literal("bluesky")),
    region: v.optional(v.string()),
    category: v.optional(v.string()),
    sourceType: v.optional(v.union(
      v.literal("wire"),
      v.literal("regional"),
      v.literal("official"),
      v.literal("ngo"),
      v.literal("social"),
      v.literal("user"),
      v.literal("other"),
    )),
    verificationLevel: v.optional(v.union(v.literal("verified"), v.literal("mixed"), v.literal("unverified"))),
    countryOfOrigin: v.optional(v.string()),
    language: v.optional(v.string()),
    coverageRegion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db
      .query("sourceCatalog")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("sourceCatalog", {
      name: args.name,
      url: args.url,
      kind: args.kind,
      enabled: true,
      region: args.region,
      category: args.category,
      sourceType: args.sourceType,
      verificationLevel: args.verificationLevel,
      countryOfOrigin: args.countryOfOrigin,
      language: args.language,
      coverageRegion: args.coverageRegion,
      consecutiveFailures: 0,
      fetchCount: 0,
      itemCount: 0,
      createdAt: Date.now(),
    });
  },
});

export const setSourceEnabled = mutation({
  args: { id: v.id("sourceCatalog"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.patch(args.id, { enabled: args.enabled });
    return { ok: true };
  },
});

export const removeSource = mutation({
  args: { id: v.id("sourceCatalog") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

// ── Feature flags ──
export const featureFlags = query({
  args: {},
  handler: async (ctx) => {
    // Public-readable: the UI reads flags without auth.
    return await ctx.db.query("featureFlags").collect();
  },
});

export const setFeatureFlag = mutation({
  args: { key: v.string(), value: v.boolean(), description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value, description: args.description, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("featureFlags", { key: args.key, value: args.value, description: args.description, updatedAt: now });
  },
});

// ── On-demand ingest trigger ──
export const requestRefresh = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const sig = await ctx.db
      .query("controlSignals")
      .withIndex("by_key", (q) => q.eq("key", "refreshRequested"))
      .unique();
    const now = Date.now();
    if (sig) {
      await ctx.db.patch(sig._id, { value: true, requestedBy: admin.email ?? admin._id, requestedAt: now });
    } else {
      await ctx.db.insert("controlSignals", { key: "refreshRequested", value: true, requestedBy: admin.email ?? admin._id, requestedAt: now });
    }
    return { ok: true };
  },
});

// ── Ingestion health dashboard ──
export const health = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const sources = await ctx.db.query("sourceCatalog").collect();
    const now = Date.now();
    const recentEvents = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", now - 6 * 3_600_000))
      .collect();
    const tierCount = { green: 0, amber: 0, red: 0, black: 0 };
    for (const e of recentEvents) tierCount[e.tier]++;
    return {
      sources: {
        total: sources.length,
        enabled: sources.filter((s) => s.enabled).length,
        degraded: sources.filter((s) => s.consecutiveFailures > 0).length,
      },
      events6h: recentEvents.length,
      tierCount,
      sourceRows: sources.map((s) => ({
        id: s._id,
        name: s.name,
        url: s.url,
        kind: s.kind,
        enabled: s.enabled,
        lastStatus: s.lastStatus ?? "—",
        lastFetchedAt: s.lastFetchedAt ?? null,
        consecutiveFailures: s.consecutiveFailures,
        itemCount: s.itemCount,
      })),
    };
  },
});
