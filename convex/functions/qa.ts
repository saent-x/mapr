import { query, mutation, internalMutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { citationValidator } from "./schema";
import { getCurrentUser, requireUser } from "./lib/access";
import { limitsForUser, tierForUser } from "./lib/entitlements";

const WINDOW_MS = 30 * 24 * 3_600_000; // trailing 30 days
const TITLE_MAX = 60;

function quotaLimit(user: Doc<"users">): number {
  return limitsForUser(user).qaTurns;
}

/**
 * Rolling 30-day usage: count this user's persisted `role:'user'` messages with
 * createdAt within the trailing window, via the by_user_created index. This is a
 * true sliding window (no fixed reset seam), so the free/pro budgets can't be
 * ~2x over-granted at a window boundary. Counting role:'user' rows means only
 * real turns charge — the budget is spent when the user message is persisted.
 */
async function rollingUsage(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  now: number,
): Promise<number> {
  const cutoff = now - WINDOW_MS;
  const rows = await ctx.db
    .query("qaMessages")
    .withIndex("by_user_created", (q) => q.eq("userId", userId).gte("createdAt", cutoff))
    .filter((q) => q.eq(q.field("role"), "user"))
    .collect();
  return rows.length;
}

/**
 * Atomically: enforce the rolling QA quota, ensure a conversation, append the
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

    // Rolling-window check: count user messages persisted in the trailing 30d.
    // The user message we are about to insert is the (used+1)th turn, so block
    // when the prior rolling count already meets the limit.
    const used = await rollingUsage(ctx, args.userId, now);
    if (used >= quotaLimit(user)) {
      throw new Error("QA_QUOTA_EXCEEDED");
    }

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
    // Quota is metered by the rolling count of persisted role:'user' messages
    // (see beginTurn/quotaStatus), so there is no separate counter to charge
    // here. The user turn was already persisted in beginTurn.
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
    // Rolling usage: same count the charge path (beginTurn) enforces.
    const used = await rollingUsage(ctx, user._id, now);
    const tier = tierForUser(user);
    const limit = quotaLimit(user);
    const unlimited = tier === "admin";
    // The window slides continuously, so the meaningful reset is when the
    // oldest in-window turn ages out. Report that for the UI countdown.
    let resetAt: number | null = null;
    if (used > 0) {
      const cutoff = now - WINDOW_MS;
      const oldest = await ctx.db
        .query("qaMessages")
        .withIndex("by_user_created", (q) => q.eq("userId", user._id).gte("createdAt", cutoff))
        .filter((q) => q.eq(q.field("role"), "user"))
        .order("asc")
        .first();
      if (oldest) resetAt = oldest.createdAt + WINDOW_MS;
    }
    return { used, limit, remaining: Math.max(0, limit - used), unlimited, tier, resetAt };
  },
});
