import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { citationValidator } from "./schema";
import { getCurrentUser, requireUser } from "./lib/access";
import { limitsForUser, tierForUser } from "./lib/entitlements";

const WINDOW_MS = 30 * 24 * 3_600_000; // trailing 30 days
const TITLE_MAX = 60;

function quotaLimit(user: Doc<"users">): number {
  return limitsForUser(user).qaTurns;
}
/**
 * Atomically: enforce+reserve the QA quota, ensure a conversation, append the
 * user message, and return prior turns for the model context. Throws
 * QA_QUOTA_EXCEEDED when the trailing-30d message budget is spent.
 */
export const beginTurn = internalMutation({
  args: {
    userId: v.id("users"),
    conversationId: v.optional(v.id("qaConversations")),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("UNAUTHENTICATED");
    const now = Date.now();

    // Roll the quota window if it expired, then check + reserve.
    let windowStart = user.qaWindowStart ?? 0;
    let windowCount = user.qaWindowCount ?? 0;
    if (now - windowStart > WINDOW_MS) {
      windowStart = now;
      windowCount = 0;
    }
    if (windowCount >= quotaLimit(user)) {
      throw new Error("QA_QUOTA_EXCEEDED");
    }
    await ctx.db.patch(args.userId, { qaWindowStart: windowStart, qaWindowCount: windowCount + 1 });

    // Ensure conversation (ownership-checked) or create one.
    let conversationId = args.conversationId;
    if (conversationId) {
      const conv = await ctx.db.get(conversationId);
      if (!conv || conv.userId !== args.userId) throw new Error("FORBIDDEN");
    } else {
      conversationId = await ctx.db.insert("qaConversations", {
        userId: args.userId,
        title: args.text.slice(0, TITLE_MAX) || "Untitled",
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Prior turns (before appending the new user message).
    const priorDocs = await ctx.db
      .query("qaMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("desc")
      .take(8);
    const prior = priorDocs.reverse().map((m) => ({ role: m.role, content: m.content }));

    await ctx.db.insert("qaMessages", {
      conversationId,
      userId: args.userId,
      role: "user",
      content: args.text,
      createdAt: now,
    });
    const conv = await ctx.db.get(conversationId);
    await ctx.db.patch(conversationId, {
      messageCount: (conv?.messageCount ?? 0) + 1,
      lastMessageAt: now,
      updatedAt: now,
    });

    return { conversationId, prior };
  },
});

/** Persist the assistant reply (server-only write). */
export const completeTurn = internalMutation({
  args: {
    conversationId: v.id("qaConversations"),
    userId: v.id("users"),
    answer: v.string(),
    citations: v.array(citationValidator),
    modelUsed: v.string(),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("qaMessages", {
      conversationId: args.conversationId,
      userId: args.userId,
      role: "assistant",
      content: args.answer,
      citations: args.citations,
      modelUsed: args.modelUsed,
      tokensIn: args.tokensIn,
      tokensOut: args.tokensOut,
      createdAt: now,
    });
    const conv = await ctx.db.get(args.conversationId);
    await ctx.db.patch(args.conversationId, {
      messageCount: (conv?.messageCount ?? 0) + 1,
      lastMessageAt: now,
      updatedAt: now,
    });
  },
});

export const listConversations = query({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("qaConversations")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(100);
    return args.includeArchived ? rows : rows.filter((r) => !r.archived);
  },
});

export const listMessages = query({
  args: { conversationId: v.id("qaConversations") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.userId !== user._id) return [];
    return await ctx.db
      .query("qaMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("asc")
      .take(200);
  },
});

export const archiveConversation = mutation({
  args: { conversationId: v.id("qaConversations") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.userId !== user._id) throw new Error("FORBIDDEN");
    await ctx.db.patch(args.conversationId, { archived: true, updatedAt: Date.now() });
    return { ok: true };
  },
});

export const quotaStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const now = Date.now();
    const windowStart = user.qaWindowStart ?? 0;
    const used = now - windowStart > WINDOW_MS ? 0 : user.qaWindowCount ?? 0;
    const resetAt = user.qaWindowStart ? user.qaWindowStart + WINDOW_MS : null;
    const tier = tierForUser(user);
    const limit = quotaLimit(user);
    const unlimited = tier === "admin";
    return { used, limit, remaining: Math.max(0, limit - used), unlimited, tier, resetAt };
  },
});
