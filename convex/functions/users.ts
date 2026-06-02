import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireUser } from "./lib/access";
import { tierForUser, limitsForUser } from "./lib/entitlements";

/** Authenticated user record (subscription/role aware), or null when signed out. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const tier = tierForUser(user);
    return {
      id: user._id,
      email: user.email ?? null,
      name: user.name ?? null,
      role: user.role ?? "user",
      subscriptionStatus: user.subscriptionStatus ?? "free",
      tier,
      limits: limitsForUser(user),
      isPro: tier === "pro" || tier === "admin",
    };
  },
});

/** Display-name update (the only user-writable profile field). */
export const updateProfile = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, { name: args.name.slice(0, 80) });
    return { ok: true };
  },
});

/** Server-of-record billing patch — called only by the Stripe webhook http action. */
export const setBillingByCustomerId = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    subscriptionStatus: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_stripeCustomerId", (q) => q.eq("stripeCustomerId", args.stripeCustomerId))
      .unique();
    if (!user) return { ok: false, reason: "no_user_for_customer" };
    await ctx.db.patch(user._id, { subscriptionStatus: args.subscriptionStatus });
    return { ok: true };
  },
});

export const linkStripeCustomer = internalMutation({
  args: { userId: v.id("users"), stripeCustomerId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { stripeCustomerId: args.stripeCustomerId });
    return { ok: true };
  },
});

/** Internal helper for actions (which lack ctx.db) to read the authed user. */
export const getById = query({
  args: { id: v.id("users") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

/** Apply migration-staged Stripe billing to a freshly created user (by email). */
export const applyPendingBilling = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user?.email) return { applied: false };
    const pending = await ctx.db
      .query("pendingBilling")
      .withIndex("by_email", (q) => q.eq("email", user.email!))
      .unique();
    if (!pending) return { applied: false };
    await ctx.db.patch(args.userId, {
      stripeCustomerId: pending.stripeCustomerId,
      subscriptionStatus: pending.subscriptionStatus,
    });
    await ctx.db.delete(pending._id);
    return { applied: true };
  },
});
