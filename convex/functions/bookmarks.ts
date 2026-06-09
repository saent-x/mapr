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
      .query("bookmarks")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
  },
});

export const toggle = mutation({
  args: {
    storyId: v.string(),
    storyTitle: v.string(),
    storySummary: v.optional(v.string()),
    source: v.optional(v.string()),
    url: v.optional(v.string()),
    eventId: v.optional(v.id("events")),
    region: v.string(),
    severity: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("bookmarks")
      .withIndex("by_user_story", (q) => q.eq("userId", user._id).eq("storyId", args.storyId))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      return { bookmarked: false };
    }
    const limits = limitsForUser(user);
    if (limits.bookmarks !== Number.MAX_SAFE_INTEGER) {
      const current = await ctx.db
        .query("bookmarks")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(limits.bookmarks + 1);
      if (current.length >= limits.bookmarks) throw new Error("FEATURE_LIMIT_BOOKMARKS");
    }
    await ctx.db.insert("bookmarks", {
      userId: user._id,
      eventId: args.eventId,
      storyId: args.storyId,
      storyTitle: args.storyTitle,
      storySummary: args.storySummary,
      source: args.source,
      url: args.url,
      region: args.region,
      severity: args.severity,
      bookmarkedAt: Date.now(),
    });
    return { bookmarked: true };
  },
});
