import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
  let clientReferenceId: Id<"users"> | undefined;
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      customerId = customerIdOf(session.customer);
      // Convex userId we stamped in billing.createCheckout — lets the mutation
      // recover (and link) the user even if stripeCustomerId isn't on the row yet.
      clientReferenceId = (session.client_reference_id ?? undefined) as Id<"users"> | undefined;
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

  let result: { duplicate: boolean; applied: boolean; failed: boolean };
  try {
    result = await ctx.runMutation(internal.stripeEvents.apply, {
      eventId: event.id,
      type: event.type,
      customerId,
      subscriptionStatus,
      clientReferenceId,
    });
  } catch {
    // Surface failures as 5xx so Stripe re-delivers.
    return new Response("processing failed", { status: 500 });
  }

  // A billing event we couldn't attribute to a user is recorded as 'failed';
  // return non-2xx so Stripe retries (the customer may get linked by then).
  if (result.failed) {
    return new Response("unattributed billing event", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

http.route({ path: "/stripe/webhook", method: "POST", handler: stripeWebhook });

/**
 * Liveness probe — no auth, no DB. External uptime monitors hit this to detect
 * the HTTP-actions layer being down. Returns 200 with a tiny JSON body.
 */
const health = httpAction(async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

http.route({ path: "/health", method: "GET", handler: health });

export default http;
