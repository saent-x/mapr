export const FEATURE_TIER_FREE = 'free';
export const FEATURE_TIER_PRO = 'pro';
export const FEATURE_TIER_DISABLED = 'disabled';

export const FEATURE_ACCESS_CATALOG = [
  {
    id: 'savedViews',
    label: 'Saved views',
    description: 'Save and recall analyst filters and map state.',
    category: 'Workflow',
    defaultTier: FEATURE_TIER_PRO,
  },
  {
    id: 'alertRules',
    label: 'Alert rules',
    description: 'Create alert rules from saved views.',
    category: 'Workflow',
    defaultTier: FEATURE_TIER_PRO,
  },
  {
    id: 'briefingExport',
    label: 'Briefing export',
    description: 'Copy or export filtered intelligence briefings.',
    category: 'Output',
    defaultTier: FEATURE_TIER_PRO,
  },
  {
    id: 'historicalQueries',
    label: 'Historical queries',
    description: 'Query previous snapshots, compare ranges, and time travel.',
    category: 'Analysis',
    defaultTier: FEATURE_TIER_PRO,
  },
  {
    id: 'bookmarks',
    label: 'Bookmarks',
    description: 'Bookmark stories for a user account.',
    category: 'Workflow',
    defaultTier: FEATURE_TIER_FREE,
  },
  {
    id: 'storyThreads',
    label: 'Story threads',
    description: 'Pin events and auto-collate follow-up coverage as a thread.',
    category: 'Workflow',
    defaultTier: FEATURE_TIER_FREE,
  },
  {
    id: 'aiBriefs',
    label: 'AI briefs',
    description: 'Generate analyst-grade event briefs with sources, key actors, and a suggested angle.',
    category: 'Analysis',
    defaultTier: FEATURE_TIER_PRO,
  },
  {
    id: 'dailyDigest',
    label: 'Daily digest',
    description: 'Per-user daily watchlist digest email.',
    category: 'Output',
    defaultTier: FEATURE_TIER_PRO,
  },
  {
    id: 'sharedViews',
    label: 'Shared view links',
    description: 'Generate read-only public links for a saved view.',
    category: 'Workflow',
    defaultTier: FEATURE_TIER_PRO,
  },
  {
    id: 'sourceCredibility',
    label: 'Source credibility panel',
    description: 'Per-event panel with first publisher, corroboration count, bias and reliability flags.',
    category: 'Analysis',
    defaultTier: FEATURE_TIER_FREE,
  },
  {
    id: 'aiQa',
    label: 'AI Q&A agent',
    description: 'Conversational search over the news corpus with inline citations. 10 messages / 30d on Free, 200 on Pro.',
    category: 'Analysis',
    defaultTier: FEATURE_TIER_FREE,
  },
  {
    id: 'beatAlerts',
    label: 'Beat-aware alerts',
    description: 'Describe your beat in plain English; new articles are scored semantically and the top matches surface in your digest.',
    category: 'Workflow',
    defaultTier: FEATURE_TIER_FREE,
  },
];

const VALID_TIERS = new Set([FEATURE_TIER_FREE, FEATURE_TIER_PRO, FEATURE_TIER_DISABLED]);

export const DEFAULT_FEATURE_FLAGS = Object.freeze({
  billingEnabled: true,
  features: Object.freeze(Object.fromEntries(
    FEATURE_ACCESS_CATALOG.map((feature) => [feature.id, feature.defaultTier]),
  )),
  updatedAt: null,
});

export function normalizeFeatureFlags(raw = {}) {
  const sourceFeatures = raw && typeof raw === 'object' && raw.features && typeof raw.features === 'object'
    ? raw.features
    : {};

  const features = {};
  for (const feature of FEATURE_ACCESS_CATALOG) {
    const configuredTier = sourceFeatures[feature.id];
    features[feature.id] = VALID_TIERS.has(configuredTier) ? configuredTier : feature.defaultTier;
  }

  return {
    billingEnabled: raw?.billingEnabled !== false,
    features,
    updatedAt: raw?.updatedAt || null,
  };
}

export function canAccessFeature(featureFlags, featureId, subscriptionStatus = FEATURE_TIER_FREE) {
  const flags = normalizeFeatureFlags(featureFlags);
  if (flags.billingEnabled === false) return true;
  const requiredTier = flags.features[featureId] || FEATURE_TIER_PRO;
  if (requiredTier === FEATURE_TIER_DISABLED) return false;
  if (requiredTier === FEATURE_TIER_FREE) return true;
  return subscriptionStatus === FEATURE_TIER_PRO || subscriptionStatus === 'enterprise';
}

export function isFeatureDisabled(featureFlags, featureId) {
  const flags = normalizeFeatureFlags(featureFlags);
  if (flags.billingEnabled === false) return false;
  return flags.features[featureId] === FEATURE_TIER_DISABLED;
}
