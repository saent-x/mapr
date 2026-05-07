/**
 * Stripe Integration — Server-Side Module
 *
 * Handles:
 *   - Creating Stripe Checkout sessions for Pro upgrades
 *   - Creating Stripe Billing Portal sessions for subscription management
 *   - Verifying and processing Stripe webhook events
 *   - Updating InstantDB subscriptionStatus on $users
 */

import Stripe from 'stripe';
import { init } from '@instantdb/admin';

// ── Configuration ──

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_pro_monthly';
const INSTANT_APP_ID = process.env.INSTANT_APP_ID || '';
const INSTANT_ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN || '';

// ── Stripe client (lazy init) ──

let _stripe = null;
function getStripe() {
  if (!_stripe) {
    if (!STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    _stripe = new Stripe(STRIPE_SECRET_KEY);
  }
  return _stripe;
}

// ── InstantDB admin client (lazy init) ──

let _db = null;
function getDb() {
  if (!_db) {
    if (!INSTANT_APP_ID || !INSTANT_ADMIN_TOKEN) {
      throw new Error('InstantDB not configured (missing INSTANT_APP_ID or INSTANT_ADMIN_TOKEN)');
    }
    _db = init({ appId: INSTANT_APP_ID, adminToken: INSTANT_ADMIN_TOKEN });
  }
  return _db;
}

// ── Helpers ──

/**
 * Update a user's subscriptionStatus in InstantDB $users.
 */
async function setUserSubscriptionStatus(userId, status, extra = {}) {
  const db = getDb();
  const tx = db.transact([
    db.tx.$users[userId].update({
      subscriptionStatus: status,
      ...extra,
    }),
  ]);
  await tx;
}

/**
 * Get user by Stripe customer ID from InstantDB.
 * Returns { id, email, subscriptionStatus } or null.
 */
async function getUserByStripeCustomerId(customerId) {
  const db = getDb();
  const result = await db.queryOnce({
    $users: {
      $: {
        where: { stripeCustomerId: customerId },
      },
    },
  });
  const users = result?.$users || [];
  return users.length > 0 ? users[0] : null;
}

/**
 * Set the Stripe customer ID on a user record.
 */
async function setUserStripeCustomerId(userId, customerId) {
  const db = getDb();
  const tx = db.transact([
    db.tx.$users[userId].update({
      stripeCustomerId: customerId,
    }),
  ]);
  await tx;
}

// ── Stripe Checkout ──

/**
 * Create a Stripe Checkout session for Pro upgrade.
 * @param {Object} params
 * @param {string} params.userId - InstantDB user ID
 * @param {string} params.email - User email
 * @param {string} params.successUrl - Where to redirect after success
 * @param {string} params.cancelUrl - Where to redirect after cancel
 * @returns {Promise<{ url: string }>}
 */
export async function createCheckoutSession({ userId, email, successUrl, cancelUrl }) {
  const stripe = getStripe();
  const db = getDb();

  // Fetch user to check for existing Stripe customer
  const userResult = await db.queryOnce({
    $users: {
      $: { where: { id: userId } },
    },
  });
  const user = userResult?.$users?.[0];

  const sessionParams = {
    mode: 'subscription',
    line_items: [
      {
        price: STRIPE_PRICE_ID,
        quantity: 1,
      },
    ],
    success_url: successUrl || `${process.env.APP_URL || 'http://localhost:5173'}/billing?session_id={CHECKOUT_SESSION_ID}&status=success`,
    cancel_url: cancelUrl || `${process.env.APP_URL || 'http://localhost:5173'}/billing?status=cancelled`,
    customer_email: email,
    metadata: {
      userId: userId,
    },
  };

  // If user already has a Stripe customer ID, use it
  if (user?.stripeCustomerId) {
    sessionParams.customer = user.stripeCustomerId;
    delete sessionParams.customer_email;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  return { url: session.url };
}

// ── Billing Portal ──

/**
 * Create a Stripe Billing Portal session.
 * @param {Object} params
 * @param {string} params.customerId - Stripe customer ID
 * @param {string} params.returnUrl - Where to redirect after portal
 * @returns {Promise<{ url: string }>}
 */
export async function createPortalSession({ customerId, returnUrl }) {
  const stripe = getStripe();

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl || `${process.env.APP_URL || 'http://localhost:5173'}/billing`,
  });

  return { url: session.url };
}

// ── Webhook Handler ──

/**
 * Process a Stripe webhook event.
 * Verifies the webhook signature, then processes known event types.
 *
 * @param {string} rawBody - Raw request body string (for signature verification)
 * @param {string} signature - Stripe-Signature header value
 * @returns {Promise<{ received: boolean, type: string }>}
 */
export async function handleStripeWebhook(rawBody, signature) {
  const stripe = getStripe();

  // Verify webhook signature
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe] Webhook signature verification failed:', err.message);
    throw Object.assign(new Error('Webhook signature verification failed'), {
      code: 'INVALID_SIGNATURE',
      statusCode: 400,
    });
  }

  console.log(`[stripe] Webhook received: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const customerId = session.customer;

      if (userId) {
        await setUserSubscriptionStatus(userId, 'pro');

        if (customerId && typeof customerId === 'string') {
          await setUserStripeCustomerId(userId, customerId);
        }

        console.log(`[stripe] User ${userId} upgraded to Pro`);
      } else {
        console.warn('[stripe] checkout.session.completed missing userId in metadata');
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      const cancelAtPeriodEnd = subscription.cancel_at_period_end;
      const currentPeriodEnd = subscription.current_period_end;

      if (typeof customerId !== 'string') break;

      const user = await getUserByStripeCustomerId(customerId);
      if (!user) {
        console.warn(`[stripe] No user found for customer ${customerId}`);
        break;
      }

      if (cancelAtPeriodEnd) {
        // User cancelled; keep Pro until period end
        // We keep subscriptionStatus as 'pro' but note the pending cancellation
        console.log(`[stripe] User ${user.id} cancelled, Pro until ${new Date(currentPeriodEnd * 1000).toISOString()}`);
        // Status stays 'pro' — only downgrade on subscription.deleted
      } else {
        // Subscription reactivated or updated
        await setUserSubscriptionStatus(user.id, 'pro');
        console.log(`[stripe] User ${user.id} subscription updated, keeping Pro`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      if (typeof customerId !== 'string') break;

      const user = await getUserByStripeCustomerId(customerId);
      if (!user) {
        console.warn(`[stripe] No user found for customer ${customerId}`);
        break;
      }

      await setUserSubscriptionStatus(user.id, 'free');
      console.log(`[stripe] User ${user.id} downgraded to Free`);
      break;
    }

    default: {
      console.log(`[stripe] Unhandled event type: ${event.type}`);
      break;
    }
  }

  return { received: true, type: event.type };
}
