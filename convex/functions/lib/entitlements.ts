import type { Doc } from "../_generated/dataModel";

export type Tier = "free" | "pro" | "admin";
export type Feature =
  | "agent_turn"
  | "watchlist_unlimited"
  | "alert_rules"
  | "brief_generate"
  | "dossier_export"
  | "custom_sources"
  | "case_files"
  | "source_confidence_deep";

export type Limits = {
  qaTurns: number;
  watchlists: number;
  savedViews: number;
  bookmarks: number;
  alertRules: number;
  cases: number;
  sourceRequestsPerMonth: number;
  exports: boolean;
  briefGenerate: boolean;
  sourceConfidenceDeep: boolean;
};

const FREE_LIMITS: Limits = {
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
};

const PRO_LIMITS: Limits = {
  qaTurns: 200,
  watchlists: Number.MAX_SAFE_INTEGER,
  savedViews: Number.MAX_SAFE_INTEGER,
  bookmarks: Number.MAX_SAFE_INTEGER,
  alertRules: Number.MAX_SAFE_INTEGER,
  cases: Number.MAX_SAFE_INTEGER,
  sourceRequestsPerMonth: 20,
  exports: true,
  briefGenerate: true,
  sourceConfidenceDeep: true,
};

const ADMIN_LIMITS: Limits = {
  qaTurns: Number.MAX_SAFE_INTEGER,
  watchlists: Number.MAX_SAFE_INTEGER,
  savedViews: Number.MAX_SAFE_INTEGER,
  bookmarks: Number.MAX_SAFE_INTEGER,
  alertRules: Number.MAX_SAFE_INTEGER,
  cases: Number.MAX_SAFE_INTEGER,
  sourceRequestsPerMonth: Number.MAX_SAFE_INTEGER,
  exports: true,
  briefGenerate: true,
  sourceConfidenceDeep: true,
};

export function tierForUser(user: Pick<Doc<"users">, "role" | "subscriptionStatus"> | null): Tier {
  if (user?.role === "admin") return "admin";
  return user?.subscriptionStatus === "active" ? "pro" : "free";
}

export function limitsForTier(tier: Tier): Limits {
  if (tier === "admin") return ADMIN_LIMITS;
  if (tier === "pro") return PRO_LIMITS;
  return FREE_LIMITS;
}

export function limitsForUser(user: Pick<Doc<"users">, "role" | "subscriptionStatus"> | null): Limits {
  return limitsForTier(tierForUser(user));
}

export function hasFeature(user: Pick<Doc<"users">, "role" | "subscriptionStatus"> | null, feature: Feature): boolean {
  const limits = limitsForUser(user);
  switch (feature) {
    case "agent_turn":
      return limits.qaTurns > 0;
    case "watchlist_unlimited":
      return limits.watchlists === Number.MAX_SAFE_INTEGER;
    case "alert_rules":
      return limits.alertRules > 0;
    case "brief_generate":
      return limits.briefGenerate;
    case "dossier_export":
      return limits.exports;
    case "custom_sources":
      return limits.sourceRequestsPerMonth > 0;
    case "case_files":
      return limits.cases > 0;
    case "source_confidence_deep":
      return limits.sourceConfidenceDeep;
  }
}

export function requireFeature(user: Pick<Doc<"users">, "role" | "subscriptionStatus"> | null, feature: Feature): void {
  if (!hasFeature(user, feature)) throw new Error("FEATURE_LOCKED");
}
