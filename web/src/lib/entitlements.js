export const FREE_LIMITS = Object.freeze({
  qaTurns: 10,
  watchlists: 1,
  savedViews: 1,
  bookmarks: 5,
  alertRules: 0,
  cases: 0,
  sourceRequestsPerMonth: 0,
  exports: false,
  briefGenerate: false,
  sourceConfidenceDeep: false,
});

export const PRO_LIMITS = Object.freeze({
  qaTurns: 200,
  watchlists: Number.POSITIVE_INFINITY,
  savedViews: Number.POSITIVE_INFINITY,
  bookmarks: Number.POSITIVE_INFINITY,
  alertRules: Number.POSITIVE_INFINITY,
  cases: Number.POSITIVE_INFINITY,
  sourceRequestsPerMonth: 20,
  exports: true,
  briefGenerate: true,
  sourceConfidenceDeep: true,
});

export function tierFromUser(me, quota) {
  if (me?.tier) return me.tier;
  if (quota?.tier) return quota.tier;
  if (me?.role === "admin") return "admin";
  return me?.isPro ? "pro" : "free";
}

export function isPaidTier(tier) {
  return tier === "pro" || tier === "admin";
}

export function limitsForTier(tier) {
  return isPaidTier(tier) ? PRO_LIMITS : FREE_LIMITS;
}

export function lockedCopy(feature) {
  switch (feature) {
    case "brief": return "Upgrade to Pro to generate and save analyst briefs.";
    case "alert": return "Upgrade to Pro to turn this signal into a standing alert.";
    case "case": return "Upgrade to Pro to build investigation case files.";
    case "export": return "Upgrade to Pro to export sourced dossiers and briefs.";
    case "source": return "Upgrade to Pro to request custom source monitoring.";
    default: return "Upgrade to Pro to unlock this workflow.";
  }
}
