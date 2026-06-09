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
    // Convex userId from the Checkout Session's client_reference_id. Lets us
    // recover (and back-link) the user when by_stripeCustomerId misses.
    clientReferenceId: v.optional(v.id("users")),
  },
  returns: v.object({ duplicate: v.boolean(), applied: v.boolean(), failed: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("stripeEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (existing && existing.status === "processed") {
      return { duplicate: true, applied: false, failed: false };
    }

    // Events that don't carry billing state (e.g. unhandled types) are
    // acknowledged as processed without touching any user.
    const hasBillingState = Boolean(args.subscriptionStatus);

    let applied = false;
    let resolvedUser = false;
    if (hasBillingState) {
      // Primary path: resolve by linked Stripe customer id.
      let user = args.customerId
        ? await ctx.db
            .query("users")
            .withIndex("by_stripeCustomerId", (q) => q.eq("stripeCustomerId", args.customerId!))
            .unique()
        : null;

      // Fallback: the customer isn't linked yet (common on the very first
      // checkout.session.completed). Recover via the Convex userId we stamped
      // as client_reference_id, then back-link the customer so future
      // subscription.* events resolve via the primary path.
      if (!user && args.clientReferenceId) {
        user = await ctx.db.get(args.clientReferenceId);
      }

      if (user) {
        resolvedUser = true;
        const patch: { subscriptionStatus: string; stripeCustomerId?: string } = {
          subscriptionStatus: args.subscriptionStatus!,
        };
        if (args.customerId && user.stripeCustomerId !== args.customerId) {
          patch.stripeCustomerId = args.customerId;
        }
        await ctx.db.patch(user._id, patch);
        applied = true;
      }
    }

    // A billing event we couldn't attribute to any user is a failure: persist
    // the ledger row as 'failed' (committed — we return rather than throw, so the
    // write survives) and signal the HTTP layer to return non-2xx so Stripe
    // retries. By the next delivery, sign-in/migration may have linked the
    // customer. The 'failed' status keeps idempotency intact: the by_eventId
    // dedup only short-circuits on 'processed', so a later retry re-applies.
    // Events with no billing state are legitimately processed without a user.
    const failed = hasBillingState && !resolvedUser;
    const status = failed ? "failed" : "processed";
    if (existing) {
      await ctx.db.patch(existing._id, { status, type: args.type });
    } else {
      await ctx.db.insert("stripeEvents", {
        eventId: args.eventId,
        type: args.type,
        status,
        receivedAt: Date.now(),
      });
    }
    return { duplicate: false, applied, failed };
  },
});
