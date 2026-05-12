/**
 * Subscription Store — Cached subscription status for feature gating.
 *
 * Reads from InstantDB $users.subscriptionStatus on init, caches in memory.
 * Provides status to all components without re-fetching on every render.
 *
 * Status values: 'free' | 'pro' | 'enterprise'
 * Default: 'free' (when not authenticated or no status set)
 */

import { create } from 'zustand';
import db from '../services/instantDb';
import { canAccessFeature, DEFAULT_FEATURE_FLAGS, normalizeFeatureFlags } from '../utils/featureAccess';

const useSubscriptionStore = create((set, get) => ({
  /** Current subscription status */
  status: 'free',
  /** Whether the initial load has completed */
  isLoading: true,
  /** Whether the user is authenticated */
  isAuthenticated: false,
  /** Stripe customer ID (for portal management) */
  stripeCustomerId: null,
  /** User ID in InstantDB */
  userId: null,
  /** Server-controlled feature access policy */
  featureFlags: DEFAULT_FEATURE_FLAGS,
  /** Whether feature flags are being loaded from the API */
  featureFlagsLoading: false,

  /**
   * Initialize subscription status from InstantDB $users record.
   * Called once on app load when auth state is known.
   */
  initFromUser: async (user) => {
    if (!user) {
      set({ status: 'free', isLoading: false, isAuthenticated: false, stripeCustomerId: null, userId: null });
      return;
    }

    set({ isAuthenticated: true, userId: user.id, isLoading: true });

    try {
      const result = await db.queryOnce({
        $users: {
          $: { where: { id: user.id } },
        },
      });

      const userRecord = result?.$users?.[0];
      const status = userRecord?.subscriptionStatus || 'free';
      const stripeCustomerId = userRecord?.stripeCustomerId || null;

      set({
        status,
        stripeCustomerId,
        isLoading: false,
      });
    } catch (err) {
      console.warn('[subscriptionStore] Failed to load subscription status:', err.message);
      set({ status: 'free', isLoading: false });
    }
  },

  /**
   * Update status locally (e.g., after checkout redirect)
   */
  setStatus: (status) => set({ status }),

  loadFeatureFlags: async () => {
    set({ featureFlagsLoading: true });
    try {
      const res = await fetch('/api/feature-flags', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      set({
        featureFlags: normalizeFeatureFlags(payload),
        featureFlagsLoading: false,
      });
    } catch (err) {
      console.warn('[subscriptionStore] Failed to load feature flags:', err.message);
      set({
        featureFlags: DEFAULT_FEATURE_FLAGS,
        featureFlagsLoading: false,
      });
    }
  },

  setFeatureFlags: (featureFlags) => set({ featureFlags: normalizeFeatureFlags(featureFlags) }),

  hasFeatureAccess: (featureId) => {
    const { featureFlags, status } = get();
    return canAccessFeature(featureFlags, featureId, status);
  },

  /**
   * Clear subscription data (on sign out)
   */
  reset: () => set({
    status: 'free',
    isLoading: true,
    isAuthenticated: false,
    stripeCustomerId: null,
    userId: null,
  }),
}));

export default useSubscriptionStore;
