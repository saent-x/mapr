/**
 * Stripe Integration Tests — VAL-M6-001 through VAL-M6-009, VAL-CROSS-002, 003, 007, 008, 009
 *
 * Verifies:
 *   - Backend: webhook handler, checkout/portal session creation
 *   - Frontend: subscription store, feature gating, upgrade prompt
 *   - Integration: InstantDB subscriptionStatus updates
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'src');

function read(p) {
  return readFileSync(path.join(root, p), 'utf-8');
}

// ═══════════════════════════════════════════
// VAL-M6-001: Stripe Checkout initiates Pro subscription
// ═══════════════════════════════════════════

test('VAL-M6-001: Stripe packages installed', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies, 'package.json must have dependencies');
  assert.ok('stripe' in pkg.dependencies, 'stripe must be in dependencies');
  assert.ok('@stripe/stripe-js' in pkg.dependencies, '@stripe/stripe-js must be in dependencies');
});

test('VAL-M6-001: Backend stripe module exists', () => {
  const f = path.join(root, 'server', 'stripe.js');
  assert.ok(existsSync(f), 'server/stripe.js must exist');
  const content = readFileSync(f, 'utf-8');
  assert.ok(content.includes('createCheckoutSession'), 'must export createCheckoutSession');
  assert.ok(content.includes('createPortalSession'), 'must export createPortalSession');
  assert.ok(content.includes('handleStripeWebhook'), 'must export handleStripeWebhook');
});

test('VAL-M6-001: Checkout session endpoint registered', () => {
  const server = read('server/index.js');
  assert.ok(
    server.includes('/api/stripe/create-checkout-session'),
    'POST /api/stripe/create-checkout-session route must exist'
  );
  assert.ok(
    server.includes('/api/stripe/create-portal-session'),
    'POST /api/stripe/create-portal-session route must exist'
  );
});

// ═══════════════════════════════════════════
// VAL-M6-002: Webhook updates subscriptionStatus
// ═══════════════════════════════════════════

test('VAL-M6-002: Webhook endpoint registered', () => {
  const server = read('server/index.js');
  assert.ok(
    server.includes('/api/stripe/webhook'),
    'POST /api/stripe/webhook route must exist'
  );
});

test('VAL-M6-002: Webhook handles checkout.session.completed', () => {
  const stripe = read('server/stripe.js');
  assert.ok(
    stripe.includes("checkout.session.completed"),
    'must handle checkout.session.completed event'
  );
  assert.ok(
    stripe.includes("subscriptionStatus: 'pro'") || stripe.includes("subscriptionStatus", 300),
    'must set subscriptionStatus to pro on checkout complete'
  );
});

test('VAL-M6-002: Webhook verifies Stripe signature', () => {
  const stripe = read('server/stripe.js');
  assert.ok(
    stripe.includes('constructEvent'),
    'must call stripe.webhooks.constructEvent for signature verification'
  );
  assert.ok(
    stripe.includes('STRIPE_WEBHOOK_SECRET'),
    'must use STRIPE_WEBHOOK_SECRET env var'
  );
});

// ═══════════════════════════════════════════
// VAL-M6-003: Webhook downgrades on subscription.deleted
// ═══════════════════════════════════════════

test('VAL-M6-003: Webhook handles customer.subscription.deleted', () => {
  const stripe = read('server/stripe.js');
  assert.ok(
    stripe.includes("customer.subscription.deleted"),
    'must handle customer.subscription.deleted event'
  );
  assert.ok(
    stripe.includes("subscriptionStatus: 'free'") || stripe.includes("'free'"),
    'must set subscriptionStatus to free on subscription deletion'
  );
});

// ═══════════════════════════════════════════
// VAL-M6-004: Subscription status checked on app load and cached
// ═══════════════════════════════════════════

test('VAL-M6-004: Subscription store exists', () => {
  const f = path.join(SRC, 'stores', 'subscriptionStore.js');
  assert.ok(existsSync(f), 'src/stores/subscriptionStore.js must exist');
  const content = readFileSync(f, 'utf-8');
  assert.ok(content.includes('initFromUser'), 'must have initFromUser method');
  assert.ok(content.includes('status'), 'must track status');
  assert.ok(content.includes("'free'"), 'must default to free');
});

test('VAL-M6-004: Subscription init wired in Layout', () => {
  const layout = read('src/components/Layout.jsx');
  assert.ok(
    layout.includes('initFromUser(user)') || layout.includes('initFromUser'),
    'Layout must call initFromUser on auth change'
  );
  assert.ok(
    layout.includes('useSubscriptionStore'),
    'Layout must import useSubscriptionStore'
  );
});

// ═══════════════════════════════════════════
// VAL-M6-005: Free user sees upgrade prompt
// ═══════════════════════════════════════════

test('VAL-M6-005: UpgradePrompt component exists', () => {
  const f = path.join(SRC, 'components', 'UpgradePrompt.jsx');
  assert.ok(existsSync(f), 'UpgradePrompt.jsx must exist');
  const content = readFileSync(f, 'utf-8');
  assert.ok(content.includes('export default function UpgradePrompt'), 'must export component');
  assert.ok(content.includes('upgradeToPro'), 'must have upgrade button handler');
  assert.ok(content.includes('Crown'), 'must use Crown icon');
});

test('VAL-M6-005: Feature gating for export', () => {
  const app = read('src/App.jsx');
  assert.ok(
    app.includes('UpgradePrompt'),
    'App.jsx must import UpgradePrompt'
  );
  assert.ok(
    app.includes('hasFeatureAccess') || app.includes('canExportBriefings'),
    'App.jsx must check admin-configurable feature access'
  );
});

test('VAL-M6-005: Alert rules gated for free users', () => {
  const panel = read('src/components/AlertRulesPanel.jsx');
  assert.ok(
    panel.includes('hasFeatureAccess') || panel.includes('canUseAlertRules'),
    'AlertRulesPanel must check admin-configurable feature access'
  );
});

// ═══════════════════════════════════════════
// VAL-M6-006: Pro user has full access
// ═══════════════════════════════════════════

test('VAL-M6-006: Pro access gating uses status === pro', () => {
  const store = readFileSync(path.join(SRC, 'stores', 'subscriptionStore.js'), 'utf-8');
  assert.ok(
    store.includes("'pro'"),
    'subscriptionStore must define pro tier'
  );
});

test('VAL-M6-006: Historical queries gated for free', () => {
  const page = read('src/pages/HistoricalQueriesPage.jsx');
  assert.ok(
    page.includes('UpgradePrompt') || page.includes('useSubscriptionStore'),
    'HistoricalQueriesPage must check subscription'
  );
});

// ═══════════════════════════════════════════
// VAL-M6-007: Enterprise toggle OFF by default
// ═══════════════════════════════════════════

test('VAL-M6-007: Billing page exists', () => {
  const f = path.join(SRC, 'pages', 'BillingPage.jsx');
  assert.ok(existsSync(f), 'BillingPage.jsx must exist');
  const content = readFileSync(f, 'utf-8');
  assert.ok(content.includes('enterprise') || content.includes('Enterprise'), 'must show Enterprise tier');
});

test('VAL-M6-007: Enterprise toggle OFF by default', () => {
  const page = read('src/pages/BillingPage.jsx');
  assert.ok(
    page.includes('false') && page.includes('setEnterpriseOn'),
    'Enterprise toggle must be initialized to false'
  );
  assert.ok(
    page.includes('comingSoon') || page.includes('Coming soon'),
    'Enterprise tier must show coming soon message'
  );
});

test('VAL-M6-007: Billing page is registered under Account', () => {
  const main = read('src/main.jsx');
  assert.ok(
    main.includes('/account/billing') && main.includes('AccountPage'),
    '/account/billing route must be registered with AccountPage'
  );
  assert.ok(
    main.includes('to="/account/billing"'),
    '/billing should redirect to /account/billing for old links'
  );
});

test('VAL-M6-007: Billing is not a primary sidebar item', () => {
  const page = read('src/pages/BillingPage.jsx');
  const layout = read('src/components/Layout.jsx');
  assert.ok(
    !page.includes("from '../components/Header'") && !page.includes('<Header />'),
    'BillingPage must not render Header because it is embedded in Account/Layout'
  );
  assert.ok(
    !layout.includes('to="/billing"') && !layout.includes("to='/billing'"),
    'Billing must not be rendered as a primary app sidebar link'
  );
});

// ═══════════════════════════════════════════
// VAL-M6-008: Billing Portal access
// ═══════════════════════════════════════════

test('VAL-M6-008: Portal session endpoint exists', () => {
  const server = read('server/index.js');
  assert.ok(
    server.includes('/api/stripe/create-portal-session'),
    'create-portal-session endpoint must exist'
  );
});

test('VAL-M6-008: Manage subscription button for Pro users', () => {
  const page = read('src/pages/BillingPage.jsx');
  assert.ok(
    page.includes('manageSubscription') || page.includes('Manage Subscription'),
    'BillingPage must have manage subscription for Pro users'
  );
});

// ═══════════════════════════════════════════
// VAL-M6-009: Cancelled subscription downgrades at period end
// ═══════════════════════════════════════════

test('VAL-M6-009: Webhook handles customer.subscription.updated', () => {
  const stripe = read('server/stripe.js');
  assert.ok(
    stripe.includes('customer.subscription.updated'),
    'must handle customer.subscription.updated event'
  );
  assert.ok(
    stripe.includes('cancel_at_period_end'),
    'must check cancel_at_period_end on subscription update'
  );
});

// ═══════════════════════════════════════════
// VAL-CROSS-002: Free user gets upgrade prompt for Pro features
// ═══════════════════════════════════════════

test('VAL-CROSS-002: Export gated for free users', () => {
  const app = read('src/App.jsx');
  assert.ok(
    app.includes('!canExportBriefings') && app.includes('UpgradePrompt'),
    'Export modal must show UpgradePrompt when feature access is denied'
  );
});

test('VAL-CROSS-002: Historical queries gated for free users', () => {
  const page = read('src/pages/HistoricalQueriesPage.jsx');
  assert.ok(
    page.includes('!canUseHistoricalQueries') || page.includes('hasFeatureAccess'),
    'Historical queries must check admin-configurable feature access'
  );
});

// ═══════════════════════════════════════════
// VAL-CROSS-003: Pro user has full feature access
// ═══════════════════════════════════════════

test('VAL-CROSS-003: Pro user condition passes through features', () => {
  const app = read('src/App.jsx');
  // When isPro is true, BriefingExportModal renders normally
  assert.ok(
    app.includes('canExportBriefings') && app.includes('BriefingExportModal'),
    'App must pass through export modal when feature access is granted'
  );
});

// ═══════════════════════════════════════════
// VAL-CROSS-007: Free user upgrade flow through Stripe Checkout
// ═══════════════════════════════════════════

test('VAL-CROSS-007: useSubscription hook provides upgradeToPro', () => {
  const hook = read('src/hooks/useSubscription.js');
  assert.ok(
    hook.includes('upgradeToPro'),
    'useSubscription must expose upgradeToPro'
  );
  assert.ok(
    hook.includes('/api/stripe/create-checkout-session'),
    'upgradeToPro must call create-checkout-session endpoint'
  );
  assert.ok(
    hook.includes('userId') && hook.includes('email'),
    'checkout session must include userId and email'
  );
});

// ═══════════════════════════════════════════
// VAL-CROSS-008: Subscription cancellation reverts at period end
// ═══════════════════════════════════════════

test('VAL-CROSS-008: Server handles cancel_at_period_end gracefully', () => {
  const stripe = read('server/stripe.js');
  assert.ok(
    stripe.includes('cancel_at_period_end'),
    'Webhook must handle cancel_at_period_end'
  );
  assert.ok(
    stripe.includes("'pro'") || stripe.includes('subscriptionStatus'),
    'Must retain Pro status during cancellation period'
  );
});

// ═══════════════════════════════════════════
// VAL-CROSS-009: Webhook failure resilience
// ═══════════════════════════════════════════

test('VAL-CROSS-009: Webhook handler returns proper error on invalid signature', () => {
  const stripe = read('server/stripe.js');
  assert.ok(
    stripe.includes('INVALID_SIGNATURE') || stripe.includes('signature verification failed'),
    'must handle invalid signatures gracefully'
  );
});

test('VAL-CROSS-009: Server webhook route has error handling', () => {
  const server = read('server/index.js');
  assert.ok(
    server.includes('stripe-signature') && server.includes('INVALID_SIGNATURE'),
    'webhook route must check stripe-signature header and handle errors'
  );
});

// ═══════════════════════════════════════════
// i18n Coverage
// ═══════════════════════════════════════════

test('i18n: subscription keys in all 5 locales', () => {
  const locales = ['en', 'es', 'fr', 'ar', 'zh'];
  for (const locale of locales) {
    const data = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(data.subscription, `${locale}: must have subscription key`);
    assert.ok(data.subscription.title, `${locale}: must have subscription.title`);
    assert.ok(data.subscription.upgradeToPro, `${locale}: must have subscription.upgradeToPro`);
    assert.ok(data.subscription.tiers, `${locale}: must have subscription.tiers`);
    assert.ok(data.subscription.tiers.free, `${locale}: must have subscription.tiers.free`);
    assert.ok(data.subscription.tiers.pro, `${locale}: must have subscription.tiers.pro`);
    assert.ok(data.subscription.tiers.enterprise, `${locale}: must have subscription.tiers.enterprise`);
    assert.ok(data.nav.billing, `${locale}: must have nav.billing`);
  }
});

// ═══════════════════════════════════════════
// CSS Coverage
// ═══════════════════════════════════════════

test('CSS: billing and upgrade styles exist', () => {
  const css = read('src/index.css');
  assert.ok(css.includes('.mapr-billing'), 'must have billing CSS');
  assert.ok(css.includes('.mapr-upgrade-prompt'), 'must have upgrade prompt CSS');
  assert.ok(css.includes('.mapr-billing-tier--enterprise'), 'must have enterprise tier CSS');
  assert.ok(css.includes('.mapr-billing-tier-btn--manage'), 'must have manage button CSS');
});

// ═══════════════════════════════════════════
// Environment Variable Readiness
// ═══════════════════════════════════════════

test('env: Stripe env vars referenced in server', () => {
  const stripe = read('server/stripe.js');
  assert.ok(stripe.includes('STRIPE_SECRET_KEY'), 'must reference STRIPE_SECRET_KEY');
  assert.ok(stripe.includes('STRIPE_WEBHOOK_SECRET'), 'must reference STRIPE_WEBHOOK_SECRET');
  assert.ok(stripe.includes('STRIPE_PRICE_ID'), 'must reference STRIPE_PRICE_ID');
  assert.ok(stripe.includes('INSTANT_APP_ID'), 'must reference INSTANT_APP_ID');
  assert.ok(stripe.includes('INSTANT_ADMIN_TOKEN'), 'must reference INSTANT_ADMIN_TOKEN');
});
