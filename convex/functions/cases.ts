import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireUser } from "./lib/access";
import { limitsForUser, requireFeature } from "./lib/entitlements";

const itemTypeValidator = v.union(v.literal("event"), v.literal("article"), v.literal("entity"), v.literal("region"), v.literal("note"));

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("cases")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: { title: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    requireFeature(user, "case_files");
    const limits = limitsForUser(user);
    if (limits.cases !== Number.MAX_SAFE_INTEGER) {
      const current = await ctx.db
        .query("cases")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(limits.cases + 1);
      if (current.length >= limits.cases) throw new Error("FEATURE_LIMIT_CASES");
    }
    const now = Date.now();
    return await ctx.db.insert("cases", {
      userId: user._id,
      title: args.title.slice(0, 120),
      description: args.description?.slice(0, 600),
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const get = query({
  args: { id: v.id("cases") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const c = await ctx.db.get(args.id);
    if (!c || c.userId !== user._id) return null;
    const items = await ctx.db
      .query("caseItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.id))
      .order("desc")
      .collect();
    return { case: c, items };
  },
});

export const addItem = mutation({
  args: {
    caseId: v.id("cases"),
    type: itemTypeValidator,
    eventId: v.optional(v.id("events")),
    articleId: v.optional(v.id("articles")),
    entity: v.optional(v.string()),
    region: v.optional(v.string()),
    note: v.optional(v.string()),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    source: v.optional(v.string()),
    url: v.optional(v.string()),
    severity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    requireFeature(user, "case_files");
    const c = await ctx.db.get(args.caseId);
    if (!c || c.userId !== user._id) throw new Error("FORBIDDEN");
    let title = args.title;
    let summary = args.summary;
    let source = args.source;
    let url = args.url;
    let severity = args.severity;
    if (args.eventId) {
      const event = await ctx.db.get(args.eventId);
      if (event) {
        title = title ?? event.title;
        summary = summary ?? event.summary;
        source = source ?? event.source;
        url = url ?? event.url;
        severity = severity ?? event.severity;
      }
    }
    if (args.articleId) {
      const article = await ctx.db.get(args.articleId);
      if (article) {
        title = title ?? article.title;
        summary = summary ?? article.summary;
        source = source ?? article.source;
        url = url ?? article.url;
        severity = severity ?? article.severity;
      }
    }
    const now = Date.now();
    const id = await ctx.db.insert("caseItems", {
      caseId: args.caseId,
      userId: user._id,
      type: args.type,
      eventId: args.eventId,
      articleId: args.articleId,
      entity: args.entity,
      region: args.region,
      note: args.note?.slice(0, 2000),
      title: title ?? args.entity ?? args.region ?? "Case note",
      summary,
      source,
      url,
      severity,
      createdAt: now,
    });
    await ctx.db.patch(args.caseId, { updatedAt: now });
    return id;
  },
});

export const archive = mutation({
  args: { id: v.id("cases"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const c = await ctx.db.get(args.id);
    if (!c || c.userId !== user._id) throw new Error("FORBIDDEN");
    await ctx.db.patch(args.id, { status: args.archived ? "archived" : "active", updatedAt: Date.now() });
    return { ok: true };
  },
});

export const removeItem = mutation({
  args: { id: v.id("caseItems") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const item = await ctx.db.get(args.id);
    if (!item || item.userId !== user._id) throw new Error("FORBIDDEN");
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});
