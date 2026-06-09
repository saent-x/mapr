import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import Stripe from "stripe";

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(key, { apiVersion: "2025-08-27.basil" });
}

function appOrigin(): string {
  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new Error("APP_ORIGIN not configured");
  return origin.replace(/\/$/, "");
}

/** Start a Stripe Checkout session for the Pro plan. Returns the redirect URL. */
export const createCheckout = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");
    const user = await ctx.runQuery(internal.users.getById, { id: userId });
    if (!user) throw new Error("UNAUTHENTICATED");

    const stripe = stripeClient();
    const priceId = process.env.STRIPE_PRICE_PRO;
    if (!priceId) throw new Error("STRIPE_PRICE_PRO not configured");

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { convexUserId: userId },
      });
      customerId = customer.id;
      await ctx.runMutation(internal.users.linkStripeCustomer, { userId, stripeCustomerId: customerId });
    }

    const origin = appOrigin();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/account?checkout=success`,
      cancel_url: `${origin}/account?checkout=cancel`,
      client_reference_id: userId,
    });
    if (!session.url) throw new Error("stripe did not return a checkout url");
    return { url: session.url };
  },
});

/** Open the Stripe billing portal for the current customer. */
export const createPortal = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED");
    const user = await ctx.runQuery(internal.users.getById, { id: userId });
    if (!user?.stripeCustomerId) throw new Error("no stripe customer for user");

    const stripe = stripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appOrigin()}/account`,
    });
    return { url: session.url };
  },
});
