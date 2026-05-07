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

const API_BASE = typeof window !== 'undefined'
  ? (window.location.origin || '')
  : '';

export default function useSubscription() {
  const { status, isLoading, isAuthenticated, stripeCustomerId } = useSubscriptionStore();
  const { user } = useAuth();

  const isFree = status === 'free';
  const isPro = status === 'pro';
  const isEnterprise = status === 'enterprise';

  /**
   * Initiate Stripe Checkout for Pro upgrade.
   */
  const upgradeToPro = useCallback(async () => {
    if (!user) return;

    const origin = window.location.origin;
    const successUrl = `${origin}/billing?status=success`;
    const cancelUrl = `${origin}/billing?status=cancelled`;

    try {
      const res = await fetch(`${API_BASE}/api/stripe/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          email: user.email,
          successUrl,
          cancelUrl,
        }),
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
  }, [user]);

  /**
   * Open Stripe Billing Portal for subscription management.
   */
  const manageSubscription = useCallback(async () => {
    if (!stripeCustomerId) return;

    const origin = window.location.origin;
    const returnUrl = `${origin}/billing`;

    try {
      const res = await fetch(`${API_BASE}/api/stripe/create-portal-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: stripeCustomerId,
          returnUrl,
        }),
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
  }, [stripeCustomerId]);

  return {
    status,
    isLoading,
    isAuthenticated,
    isFree,
    isPro,
    isEnterprise,
    stripeCustomerId,
    upgradeToPro,
    manageSubscription,
  };
}
