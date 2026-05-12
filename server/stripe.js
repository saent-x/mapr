/**
 * Stripe Integration — Server-Side Module
 *
 * Handles:
 *   - Creating Stripe Checkout sessions for Pro upgrades
 *   - Creating Stripe Billing Portal sessions for subscription management
 *   - Verifying and processing Stripe webhook events
 *   - Updating InstantDB subscriptionStatus on $users
 *
 * Security model:
 *   - All callers must already be authenticated. Endpoints in
 *     server/index.js verify the InstantDB bearer token and pass the
 *     authenticated user record into the helpers below; this module
 *     never trusts arbitrary userId/customerId from the request body.
 *   - Webhook is idempotent (`stripe_events` table) and only grants
 *     entitlements when the subscription actually contains our PRICE_ID.
 *   - Internal failures (e.g. InstantDB outage) do NOT propagate to
 *     Stripe; we ack the webhook and queue a local retry instead, so
 *     Stripe doesn't pile up retries during a downstream outage.
 */

import Stripe from 'stripe';
import { init } from '@instantdb/admin';
import { log } from './logger.js';
import { claimStripeEvent, markStripeEventProcessed } from './stripeIdempotency.js';

// ── Configuration ──

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_pro_monthly';
const INSTANT_APP_ID = process.env.INSTANT_APP_ID || '';
const INSTANT_ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN || '';
// Pin the API version so a future Stripe upgrade doesn't silently change shapes.
const STRIPE_API_VERSION = process.env.STRIPE_API_VERSION || '2024-06-20';

function appBaseUrl() {
  const value = String(process.env.APP_URL || '').trim();
  if (value) return value;
  const isProd = process.env.NODE_ENV === 'production'
    || !!process.env.RAILWAY_ENVIRONMENT
    || !!process.env.RAILWAY_PUBLIC_DOMAIN;
  if (isProd) {
    throw Object.assign(new Error('APP_URL must be set in production'), {
      code: 'CONFIG_ERROR',
      statusCode: 500,
    });
  }
  return 'http://localhost:5173';
}

function sameOriginReturnUrl(value, fallbackPath) {
  const fallback = `${appBaseUrl().replace(/\/$/, '')}${fallbackPath.startsWith('/') ? fallbackPath : `/${fallbackPath}`}`;
  if (!value) return fallback;
  try {
    const candidate = new URL(value, appBaseUrl());
    const base = new URL(appBaseUrl());
    if (candidate.origin !== base.origin) return fallback;
    return candidate.toString();
  } catch {
    return fallback;
  }
}

// ── Stripe client (lazy init) ──

let _stripe = null;
function getStripe() {
  if (!_stripe) {
    if (!STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    _stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 2,
      timeout: 20000,
    });
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

async function setUserSubscriptionStatus(userId, status, extra = {}) {
  const db = getDb();
  await db.transact([
    db.tx.$users[userId].update({
      subscriptionStatus: status,
      ...extra,
    }),
  ]);
}

async function getUserByStripeCustomerId(customerId) {
  const db = getDb();
  const result = await db.query({
    $users: {
      $: { where: { stripeCustomerId: customerId } },
    },
  });
  const users = result?.$users || [];
  return users.length > 0 ? users[0] : null;
}

async function setUserStripeCustomerId(userId, customerId) {
  const db = getDb();
  await db.transact([
    db.tx.$users[userId].update({ stripeCustomerId: customerId }),
  ]);
}

/**
 * Inspect a subscription to decide whether it grants Pro entitlement.
 *   - Must contain our configured price ID
 *   - Must be in an active-like status (active, trialing, past_due is grace)
 */
function subscriptionGrantsPro(subscription) {
  if (!subscription) return false;
  const status = subscription.status;
  const grantsByStatus = status === 'active' || status === 'trialing' || status === 'past_due';
  if (!grantsByStatus) return false;
  const items = subscription.items?.data || [];
  return items.some((item) => item?.price?.id === STRIPE_PRICE_ID);
}

// ── Stripe Checkout ──

/**
 * Create a Stripe Checkout session for Pro upgrade.
 * Caller MUST pass an authenticated user record (server-of-record);
 * the userId/email here are not from the client body.
 */
export async function createCheckoutSession({ user, successUrl, cancelUrl }) {
  if (!user || !user.id || !user.email) {
    throw Object.assign(new Error('createCheckoutSession requires authenticated user'), {
      code: 'BAD_REQUEST',
      statusCode: 400,
    });
  }
  const stripe = getStripe();
  const db = getDb();
  const safeSuccessUrl = sameOriginReturnUrl(successUrl, '/account/billing?session_id={CHECKOUT_SESSION_ID}&status=success');
  const safeCancelUrl = sameOriginReturnUrl(cancelUrl, '/account/billing?status=cancelled');

  // Fetch latest user record (for stripeCustomerId).
  const userResult = await db.query({
    $users: { $: { where: { id: user.id } } },
  });
  const fullUser = userResult?.$users?.[0];

  const sessionParams = {
    mode: 'subscription',
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    success_url: safeSuccessUrl,
    cancel_url: safeCancelUrl,
    customer_email: user.email,
    // Bind the InstantDB user id so the webhook can reconcile.
    metadata: { userId: user.id },
    subscription_data: { metadata: { userId: user.id } },
  };

  if (fullUser?.stripeCustomerId) {
    sessionParams.customer = fullUser.stripeCustomerId;
    delete sessionParams.customer_email;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  return { url: session.url };
}

// ── Billing Portal ──

/**
 * Create a Stripe Billing Portal session.
 * The customerId is derived server-side from the authenticated user's
 * record — never accepted from the client body — to prevent IDOR.
 */
export async function createPortalSession({ user, returnUrl }) {
  if (!user || !user.id) {
    throw Object.assign(new Error('createPortalSession requires authenticated user'), {
      code: 'UNAUTHORIZED',
      statusCode: 401,
    });
  }
  const db = getDb();
  const userResult = await db.query({
    $users: { $: { where: { id: user.id } } },
  });
  const fullUser = userResult?.$users?.[0];
  const customerId = fullUser?.stripeCustomerId;
  if (!customerId) {
    throw Object.assign(new Error('No Stripe customer for this account'), {
      code: 'NO_CUSTOMER',
      statusCode: 404,
    });
  }
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: sameOriginReturnUrl(returnUrl, '/account/billing'),
  });
  return { url: session.url };
}

// ── Webhook Handler ──

/**
 * Process a Stripe webhook event.
 *
 * Returns one of:
 *   - { received: true, type, deduped: true }    — already processed
 *   - { received: true, type, ok: true }         — processed successfully
 *   - { received: true, type, deferred: true }   — internal failure, will retry locally
 *
 * NEVER throws on internal failures: we always ack Stripe with 200 to
 * prevent retry storms during InstantDB outages. Signature errors are
 * the one exception (we throw with statusCode 400).
 */
export async function handleStripeWebhook(rawBody, signature) {
  const stripe = getStripe();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    log.warn('stripe_webhook_invalid_signature', { msg: err.message });
    throw Object.assign(new Error('Webhook signature verification failed'), {
      code: 'INVALID_SIGNATURE',
      statusCode: 400,
    });
  }

  // Two-phase idempotency: claim first, mark processed only after success.
  // A handler crash between claim and mark leaves processed_at NULL so the
  // next retry resumes processing instead of being silently deduped.
  let claim = { shouldProcess: true, isFirst: true };
  try {
    claim = await claimStripeEvent(event.id, event.type);
  } catch (err) {
    // If the idempotency layer is down, prefer to process (at-least-once)
    // rather than skip — but log loudly so we notice.
    log.error('stripe_idempotency_unavailable', { msg: err.message, eventId: event.id });
  }

  if (!claim.shouldProcess) {
    log.info('stripe_webhook_deduped', { type: event.type, eventId: event.id });
    return { received: true, type: event.type, deduped: true };
  }

  if (!claim.isFirst) {
    log.warn('stripe_webhook_replay_after_crash', { type: event.type, eventId: event.id });
  }

  try {
    await dispatchEvent(event);
    try {
      await markStripeEventProcessed(event.id);
    } catch (err) {
      log.error('stripe_idempotency_mark_failed', { msg: err.message, eventId: event.id });
    }
    return { received: true, type: event.type, ok: true };
  } catch (err) {
    // Do NOT propagate to Stripe — we own retries from here.
    log.error('stripe_webhook_handler_failed', {
      type: event.type,
      eventId: event.id,
      msg: err.message,
    });
    return { received: true, type: event.type, deferred: true };
  }
}

async function dispatchEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event);
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return handleSubscriptionUpserted(event);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(event);
    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(event);
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
      return handleInvoicePaid(event);
    case 'customer.subscription.trial_will_end':
      log.info('stripe_trial_will_end', { customerId: event.data.object?.customer });
      return;
    default:
      log.info('stripe_unhandled_event', { type: event.type });
      return;
  }
}

async function handleCheckoutCompleted(event) {
  const session = event.data.object;
  const userId = session.metadata?.userId;
  const customerId = session.customer;
  const subscriptionId = session.subscription;

  if (!userId) {
    log.warn('stripe_checkout_missing_userId', { sessionId: session.id });
    return;
  }

  // Verify the underlying subscription contains our PRICE_ID before granting Pro.
  // If we can't fetch the subscription, throw so the outer handler returns
  // `deferred` and the next webhook retry re-attempts the upgrade. Swallowing
  // here would charge the user but never flip them to Pro.
  let granted = false;
  if (subscriptionId && typeof subscriptionId === 'string') {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    granted = subscriptionGrantsPro(sub);
  }

  // For one-shot or incomplete subs we still record the customer link, but only
  // grant Pro when the subscription actually contains our price.
  if (granted) {
    await setUserSubscriptionStatus(userId, 'pro');
  }
  if (customerId && typeof customerId === 'string') {
    await setUserStripeCustomerId(userId, customerId);
  }
  log.info('stripe_checkout_completed', { userId, customerId, granted });
}

async function handleSubscriptionUpserted(event) {
  const subscription = event.data.object;
  const customerId = subscription.customer;
  if (typeof customerId !== 'string') return;

  const user = await resolveUserForCustomer(customerId, subscription);
  if (!user) {
    log.warn('stripe_subscription_no_user', { customerId, subId: subscription.id });
    return;
  }

  if (subscriptionGrantsPro(subscription)) {
    await setUserSubscriptionStatus(user.id, 'pro');
    log.info('stripe_subscription_active', {
      userId: user.id,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    });
  } else {
    // Sub exists but does not grant Pro (canceled, unpaid, or wrong price).
    await setUserSubscriptionStatus(user.id, 'free');
    log.info('stripe_subscription_inactive', { userId: user.id, status: subscription.status });
  }
}

async function handleSubscriptionDeleted(event) {
  const subscription = event.data.object;
  const customerId = subscription.customer;
  if (typeof customerId !== 'string') return;

  const user = await resolveUserForCustomer(customerId, subscription);
  if (!user) {
    log.warn('stripe_subscription_deleted_no_user', { customerId });
    return;
  }
  await setUserSubscriptionStatus(user.id, 'free');
  log.info('stripe_subscription_deleted', { userId: user.id });
}

async function handleInvoicePaymentFailed(event) {
  const invoice = event.data.object;
  const customerId = invoice.customer;
  if (typeof customerId !== 'string') return;
  const user = await getUserByStripeCustomerId(customerId);
  if (!user) {
    log.warn('stripe_invoice_failed_no_user', { customerId });
    return;
  }
  // Mark past_due so UI can surface a payment-action CTA.
  await setUserSubscriptionStatus(user.id, 'past_due');
  log.warn('stripe_invoice_payment_failed', { userId: user.id, invoiceId: invoice.id });
}

async function handleInvoicePaid(event) {
  const invoice = event.data.object;
  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;
  if (typeof customerId !== 'string') return;
  const user = await getUserByStripeCustomerId(customerId);
  if (!user) {
    log.info('stripe_invoice_paid_no_user', { customerId });
    return;
  }
  // Re-confirm Pro by inspecting the underlying subscription.
  if (subscriptionId && typeof subscriptionId === 'string') {
    try {
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      if (subscriptionGrantsPro(sub)) {
        await setUserSubscriptionStatus(user.id, 'pro');
        log.info('stripe_invoice_paid_pro_confirmed', { userId: user.id });
      }
    } catch (err) {
      log.warn('stripe_invoice_paid_sub_fetch_failed', { userId: user.id, msg: err.message });
    }
  }
}

/**
 * Resolve the InstantDB user for a Stripe customer.
 * Falls back to the `userId` metadata on the subscription if the
 * customerId mapping was not yet persisted (rare race).
 */
async function resolveUserForCustomer(customerId, subscription) {
  const direct = await getUserByStripeCustomerId(customerId);
  if (direct) return direct;
  const fallbackId = subscription?.metadata?.userId;
  if (!fallbackId) return null;
  const db = getDb();
  const result = await db.query({
    $users: { $: { where: { id: fallbackId } } },
  });
  const user = result?.$users?.[0];
  if (user && !user.stripeCustomerId) {
    // Heal the link so future webhooks resolve directly.
    await setUserStripeCustomerId(user.id, customerId);
  }
  return user || null;
}
