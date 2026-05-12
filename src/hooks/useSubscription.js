/**
 * useSubscription Hook — Feature gating and Stripe checkout integration.
 *
 * Provides:
 *   - isFree / isPro / status / isLoading — subscription state
 *   - upgradeToPro() — initiates Stripe Checkout
 *   - manageSubscription() — opens Billing Portal
 */

import { useCallback } from 'react';
import useSubscriptionStore from '../stores/subscriptionStore';
import useAuth from './useAuth';
import { canAccessFeature } from '../utils/featureAccess';
import db from '../services/instantDb';

const API_BASE = typeof window !== 'undefined'
  ? (window.location.origin || '')
  : '';

// Pull the InstantDB session token so the server can verify the caller.
async function authHeaders() {
  try {
    const u = await db.getAuth();
    const token = u?.refresh_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export default function useSubscription() {
  const { status, isLoading, isAuthenticated, stripeCustomerId, featureFlags, featureFlagsLoading } = useSubscriptionStore();
  const { user } = useAuth();

  const isFree = status === 'free';
  const isPro = status === 'pro';
  const isEnterprise = status === 'enterprise';
  const billingEnabled = featureFlags?.billingEnabled !== false;
  const hasFeatureAccess = useCallback(
    (featureId) => canAccessFeature(featureFlags, featureId, status),
    [featureFlags, status],
  );

  /**
   * Initiate Stripe Checkout for Pro upgrade.
   */
  const upgradeToPro = useCallback(async () => {
    if (!user || !billingEnabled) return;

    const origin = window.location.origin;
    const successUrl = `${origin}/account/billing?status=success`;
    const cancelUrl = `${origin}/account/billing?status=cancelled`;

    try {
      const res = await fetch(`${API_BASE}/api/stripe/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        // Server derives userId/email from the bearer token; only the return URLs
        // need to come from the client.
        body: JSON.stringify({ successUrl, cancelUrl }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create checkout session');
      }

      const { url } = await res.json();
      if (url) {
        window.location.href = url;
      }
    } catch (err) {
      console.error('[useSubscription] Checkout error:', err.message);
      throw err;
    }
  }, [user, billingEnabled]);

  /**
   * Open Stripe Billing Portal for subscription management.
   */
  const manageSubscription = useCallback(async () => {
    const origin = window.location.origin;
    const returnUrl = `${origin}/account/billing`;

    try {
      const res = await fetch(`${API_BASE}/api/stripe/create-portal-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        // Server looks up the customerId from the authenticated user — never
        // accept it from the client (would be an IDOR).
        body: JSON.stringify({ returnUrl }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create portal session');
      }

      const { url } = await res.json();
      if (url) {
        window.location.href = url;
      }
    } catch (err) {
      console.error('[useSubscription] Portal error:', err.message);
      throw err;
    }
  }, []);

  return {
    status,
    isLoading,
    isAuthenticated,
    isFree,
    isPro,
    isEnterprise,
    billingEnabled,
    featureFlags,
    featureFlagsLoading,
    stripeCustomerId,
    hasFeatureAccess,
    upgradeToPro,
    manageSubscription,
  };
}
