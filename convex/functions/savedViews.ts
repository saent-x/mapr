import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireUser } from "./lib/access";
import { limitsForUser } from "./lib/entitlements";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("savedViews")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
  },
});

export const save = mutation({
  args: {
    id: v.optional(v.id("savedViews")),
    name: v.string(),
    description: v.optional(v.string()),
    filterState: v.string(),
    mapState: v.string(),
    pinned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    if (args.id) {
      const view = await ctx.db.get(args.id);
      if (!view || view.userId !== user._id) throw new Error("FORBIDDEN");
      await ctx.db.patch(args.id, {
        name: args.name,
        description: args.description,
        filterState: args.filterState,
        mapState: args.mapState,
        pinned: args.pinned,
        updatedAt: now,
      });
      return args.id;
    }
    const limits = limitsForUser(user);
    if (limits.savedViews !== Number.MAX_SAFE_INTEGER) {
      const current = await ctx.db
        .query("savedViews")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(limits.savedViews + 1);
      if (current.length >= limits.savedViews) throw new Error("FEATURE_LIMIT_SAVED_VIEWS");
    }
    return await ctx.db.insert("savedViews", {
      userId: user._id,
      name: args.name,
      description: args.description,
      filterState: args.filterState,
      mapState: args.mapState,
      pinned: args.pinned,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("savedViews") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const view = await ctx.db.get(args.id);
    if (!view || view.userId !== user._id) throw new Error("FORBIDDEN");
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});
