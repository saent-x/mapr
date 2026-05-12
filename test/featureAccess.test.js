import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessFeature,
  FEATURE_ACCESS_CATALOG,
  FEATURE_TIER_DISABLED,
  FEATURE_TIER_FREE,
  FEATURE_TIER_PRO,
  normalizeFeatureFlags,
} from '../src/utils/featureAccess.js';

test('feature access defaults make saved views and paid workflows Pro-gated', () => {
  const flags = normalizeFeatureFlags();
  assert.equal(flags.features.savedViews, FEATURE_TIER_PRO);
  assert.equal(flags.features.alertRules, FEATURE_TIER_PRO);
  assert.equal(flags.features.briefingExport, FEATURE_TIER_PRO);
  assert.equal(flags.features.historicalQueries, FEATURE_TIER_PRO);
  assert.equal(flags.features.bookmarks, FEATURE_TIER_FREE);
});

test('feature access can make Pro features available to free users', () => {
  const flags = normalizeFeatureFlags({
    features: Object.fromEntries(FEATURE_ACCESS_CATALOG.map((feature) => [feature.id, FEATURE_TIER_FREE])),
  });
  assert.equal(canAccessFeature(flags, 'savedViews', 'free'), true);
  assert.equal(canAccessFeature(flags, 'briefingExport', 'free'), true);
});

test('feature access can move free features behind Pro or turn them off', () => {
  const proOnly = normalizeFeatureFlags({ features: { bookmarks: FEATURE_TIER_PRO } });
  assert.equal(canAccessFeature(proOnly, 'bookmarks', 'free'), false);
  assert.equal(canAccessFeature(proOnly, 'bookmarks', 'pro'), true);

  const disabled = normalizeFeatureFlags({ features: { bookmarks: FEATURE_TIER_DISABLED } });
  assert.equal(canAccessFeature(disabled, 'bookmarks', 'enterprise'), false);
});

test('billing disabled removes subscription paywalls across configured features', () => {
  const flags = normalizeFeatureFlags({
    billingEnabled: false,
    features: {
      savedViews: FEATURE_TIER_PRO,
      alertRules: FEATURE_TIER_PRO,
      briefingExport: FEATURE_TIER_DISABLED,
      historicalQueries: FEATURE_TIER_PRO,
      bookmarks: FEATURE_TIER_PRO,
    },
  });
  assert.equal(canAccessFeature(flags, 'savedViews', 'free'), true);
  assert.equal(canAccessFeature(flags, 'alertRules', 'free'), true);
  assert.equal(canAccessFeature(flags, 'briefingExport', 'free'), true);
  assert.equal(canAccessFeature(flags, 'historicalQueries', 'free'), true);
  assert.equal(canAccessFeature(flags, 'bookmarks', 'free'), true);
});
