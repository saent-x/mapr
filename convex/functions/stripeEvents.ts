import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Idempotent Stripe event application. The webhook httpAction verifies the
 * signature, derives {customerId, subscriptionStatus}, then calls this. Replays
 * of the same eventId are a no-op (Stripe retries are at-least-once).
 */
export const apply = internalMutation({
  args: {
    eventId: v.string(),
    type: v.string(),
    customerId: v.optional(v.string()),
    subscriptionStatus: v.optional(v.string()),
  },
  returns: v.object({ duplicate: v.boolean(), applied: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("stripeEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (existing && existing.status === "processed") {
      return { duplicate: true, applied: false };
    }

    let applied = false;
    if (args.customerId && args.subscriptionStatus) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_stripeCustomerId", (q) => q.eq("stripeCustomerId", args.customerId!))
        .unique();
      if (user) {
        await ctx.db.patch(user._id, { subscriptionStatus: args.subscriptionStatus });
        applied = true;
      }
    }

    if (existing) {
      await ctx.db.patch(existing._id, { status: "processed", type: args.type });
    } else {
      await ctx.db.insert("stripeEvents", {
        eventId: args.eventId,
        type: args.type,
        status: "processed",
        receivedAt: Date.now(),
      });
    }
    return { duplicate: false, applied };
  },
});
