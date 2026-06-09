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
      .query("watchlistItems")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
  },
});

export const add = mutation({
  args: { type: v.string(), value: v.string(), label: v.string(), digestSchedule: v.optional(digestScheduleValidator) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("watchlistItems")
      .withIndex("by_user_value", (q) => q.eq("userId", user._id).eq("type", args.type).eq("value", args.value))
      .unique();
    if (existing) return existing._id;
    const limits = limitsForUser(user);
    if (limits.watchlists !== Number.MAX_SAFE_INTEGER) {
      const current = await ctx.db
        .query("watchlistItems")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(limits.watchlists + 1);
      if (current.length >= limits.watchlists) throw new Error("FEATURE_LIMIT_WATCHLIST");
    }
    return await ctx.db.insert("watchlistItems", {
      userId: user._id,
      type: args.type,
      value: args.value,
      label: args.label,
      addedAt: Date.now(),
      digestSchedule: args.digestSchedule,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("watchlistItems") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const item = await ctx.db.get(args.id);
    if (!item || item.userId !== user._id) throw new Error("FORBIDDEN");
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

export const matches = query({
  args: {
    isoA2: v.optional(v.string()),
    entities: v.optional(v.array(v.string())),
    text: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const items = await ctx.db
      .query("watchlistItems")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const entitySet = new Set((args.entities ?? []).map((x) => x.toLowerCase()));
    const text = (args.text ?? "").toLowerCase();
    return items.filter((item) => {
      if (item.type === "region") return !!args.isoA2 && item.value.toUpperCase() === args.isoA2.toUpperCase();
      if (item.type === "entity") return entitySet.has(item.value.toLowerCase());
      if (item.type === "keyword") return text.includes(item.value.toLowerCase());
      return false;
    });
  },
});
