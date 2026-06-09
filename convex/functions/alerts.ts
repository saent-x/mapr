import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { digestScheduleValidator } from "./schema";
import { getCurrentUser, requireUser } from "./lib/access";
import { limitsForUser } from "./lib/entitlements";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("alertRules")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    severityThreshold: v.number(),
    minConfidence: v.optional(v.number()),
    isoA2: v.optional(v.string()),
    category: v.optional(v.string()),
    keyword: v.optional(v.string()),
    savedViewId: v.optional(v.id("savedViews")),
    channels: v.optional(v.array(v.string())),
    emailAddress: v.optional(v.string()),
    digestSchedule: v.optional(digestScheduleValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const limits = limitsForUser(user);
    if (limits.alertRules <= 0) throw new Error("FEATURE_LOCKED_ALERTS");
    if (limits.alertRules !== Number.MAX_SAFE_INTEGER) {
      const current = await ctx.db
        .query("alertRules")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(limits.alertRules + 1);
      if (current.length >= limits.alertRules) throw new Error("FEATURE_LIMIT_ALERTS");
    }
    return await ctx.db.insert("alertRules", {
      userId: user._id,
      name: args.name,
      severityThreshold: args.severityThreshold,
      minConfidence: args.minConfidence,
      savedViewId: args.savedViewId,
      channels: args.channels,
      isoA2: args.isoA2,
      category: args.category,
      keyword: args.keyword,
      emailAddress: args.emailAddress,
      digestSchedule: args.digestSchedule,
      active: true,
      createdAt: Date.now(),
    });
  },
});

export const setActive = mutation({
  args: { id: v.id("alertRules"), active: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const rule = await ctx.db.get(args.id);
    if (!rule || rule.userId !== user._id) throw new Error("FORBIDDEN");
    await ctx.db.patch(args.id, { active: args.active });
    return { ok: true };
  },
});

export const remove = mutation({
  args: { id: v.id("alertRules") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const rule = await ctx.db.get(args.id);
    if (!rule || rule.userId !== user._id) throw new Error("FORBIDDEN");
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

export const preview = query({
  args: {
    severityThreshold: v.number(),
    isoA2: v.optional(v.string()),
    category: v.optional(v.string()),
    windowHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { locked: true, count: 0, sample: [] };
    const limits = limitsForUser(user);
    const locked = limits.alertRules <= 0;
    const cutoff = Date.now() - (args.windowHours ?? 168) * 3_600_000;
    const rows = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
      .order("desc")
      .take(500);
    const matches = rows.filter((e) => {
      if (e.severity < args.severityThreshold) return false;
      if (args.isoA2 && e.isoA2 !== args.isoA2) return false;
      if (args.category && e.category !== args.category) return false;
      return true;
    });
    return {
      locked,
      count: matches.length,
      sample: matches.slice(0, 5).map((e) => ({
        id: e._id,
        title: e.title,
        isoA2: e.isoA2,
        tier: e.tier,
        severity: e.severity,
        publishedAt: e.publishedAt,
      })),
    };
  },
});
