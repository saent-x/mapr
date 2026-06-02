import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import Stripe from "stripe";

const http = httpRouter();

// Convex Auth: /api/auth/* sign-in + session routes.
auth.addHttpRoutes(http);

function customerIdOf(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.id;
}

function statusFromSubscription(s: Stripe.Subscription): string {
  switch (s.status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    default:
      return "canceled";
  }
}

/**
 * Stripe webhook — raw-body signature verification, idempotent application,
 * mark-failure -> non-2xx so Stripe retries. Public via the deployment's
 * HTTP-actions origin (tunnel in prod).
 */
const stripeWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !key) return new Response("billing not configured", { status: 503 });

  const sig = request.headers.get("stripe-signature");
  if (!sig) return new Response("missing signature", { status: 400 });
  const body = await request.text();

  const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, secret);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  let customerId: string | undefined;
  let subscriptionStatus: string | undefined;
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      customerId = customerIdOf(session.customer);
      subscriptionStatus = "active";
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      customerId = customerIdOf(sub.customer);
      subscriptionStatus = event.type === "customer.subscription.deleted" ? "canceled" : statusFromSubscription(sub);
      break;
    }
    default:
      // Unhandled event types are acknowledged so Stripe stops retrying.
      break;
  }

  try {
    await ctx.runMutation(internal.stripeEvents.apply, {
      eventId: event.id,
      type: event.type,
      customerId,
      subscriptionStatus,
    });
  } catch {
    // Surface failures as 5xx so Stripe re-delivers.
    return new Response("processing failed", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

http.route({ path: "/stripe/webhook", method: "POST", handler: stripeWebhook });

export default http;
