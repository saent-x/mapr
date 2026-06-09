import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireAdmin, requireUser } from "./lib/access";
import { limitsForUser, requireFeature } from "./lib/entitlements";
import { assertPublicSourceUrl } from "./admin";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("sourceRequests")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
  },
});

export const submit = mutation({
  args: {
    name: v.string(),
    url: v.string(),
    reason: v.string(),
    region: v.optional(v.string()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    requireFeature(user, "custom_sources");
    // Reject internal/private targets at request time (mirrors the worker's
    // SSRF policy) so an unsafe URL never reaches the admin review queue.
    assertPublicSourceUrl(args.url);
    const limits = limitsForUser(user);
    if (limits.sourceRequestsPerMonth !== Number.MAX_SAFE_INTEGER) {
      const cutoff = Date.now() - 30 * 24 * 3_600_000;
      const rows = await ctx.db
        .query("sourceRequests")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(limits.sourceRequestsPerMonth + 1);
      if (rows.filter((r) => r.createdAt >= cutoff).length >= limits.sourceRequestsPerMonth) {
        throw new Error("FEATURE_LIMIT_SOURCE_REQUESTS");
      }
    }
    return await ctx.db.insert("sourceRequests", {
      userId: user._id,
      name: args.name.slice(0, 120),
      url: args.url.slice(0, 1000),
      reason: args.reason.slice(0, 1000),
      region: args.region,
      category: args.category,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const listAdmin = query({
  args: { status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"))) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.status) {
      return await ctx.db
        .query("sourceRequests")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(100);
    }
    return await ctx.db.query("sourceRequests").order("desc").take(100);
  },
});

export const review = mutation({
  args: {
    id: v.id("sourceRequests"),
    status: v.union(v.literal("approved"), v.literal("rejected")),
    adminNote: v.optional(v.string()),
    approveAsSource: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const req = await ctx.db.get(args.id);
    if (!req) throw new Error("NOT_FOUND");
    let sourceId = null;
    if (args.status === "approved" && args.approveAsSource) {
      // Re-validate at catalog-write time: the request may predate this guard,
      // so never promote an internal/private URL into the fetchable catalog.
      assertPublicSourceUrl(req.url);
      const existing = await ctx.db
        .query("sourceCatalog")
        .withIndex("by_url", (q) => q.eq("url", req.url))
        .unique();
      sourceId = existing?._id ?? await ctx.db.insert("sourceCatalog", {
        name: req.name,
        url: req.url,
        kind: "rss",
        enabled: false,
        region: req.region,
        category: req.category,
        sourceType: "user",
        verificationLevel: "mixed",
        consecutiveFailures: 0,
        fetchCount: 0,
        itemCount: 0,
        createdAt: Date.now(),
      });
    }
    await ctx.db.patch(args.id, {
      status: args.status,
      adminNote: args.adminNote,
      reviewedAt: Date.now(),
      reviewedBy: admin._id,
    });
    return { ok: true, sourceId };
  },
});
