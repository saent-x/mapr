const HIGH_IMPACT_ENTITY_TYPES = new Set(['military', 'rebel', 'terrorist', 'paramilitary', 'militant']);

// Accepts both codebase categories (Seismic, Weather, etc.) and NER categories (disaster, conflict, etc.)
const CATEGORY_WEIGHTS = {
  Conflict: 90, Seismic: 85, Weather: 80, Humanitarian: 75, Civil: 65,
  Health: 60, Political: 50, Economic: 45, Infrastructure: 40, Climate: 35,
  conflict: 90, disaster: 85, humanitarian: 75, political: 50, economic: 45,
  General: 30, general: 30
};

// ── Entity significance ──────────────────────────────────────────────────────

/**
 * Patterns indicating heads of state or senior government figures.
 * Matched case-insensitively against entity people names.
 */
const HEAD_OF_STATE_PATTERNS = [
  /\bpresident\b/i,
  /\bprime\s+minister\b/i,
  /\bchancellor\b/i,
  /\bking\b/i,
  /\bqueen\b/i,
  /\bemperor\b/i,
  /\bsultan\b/i,
  /\bemir\b/i,
  /\bpope\b/i,
  /\bayatollah\b/i,
  /\bsecretary[\s-]general\b/i,
  /\bsupreme\s+leader\b/i,
  /\bhead\s+of\s+state\b/i,
  /\bforeign\s+minister\b/i,
  /\bdefense\s+minister\b/i,
  /\bdefence\s+minister\b/i,
];

/**
 * Major international organizations whose involvement elevates event significance.
 * Matched case-insensitively against organization names.
 */
const SIGNIFICANT_ORG_NAMES = new Set([
  'united nations', 'un', 'u.n.',
  'nato', 'north atlantic treaty organization',
  'european union', 'eu', 'e.u.',
  'world health organization', 'who',
  'international criminal court', 'icc',
  'un security council', 'united nations security council', 'security council',
  'imf', 'international monetary fund',
  'world bank',
  'iaea', 'international atomic energy agency',
  'african union', 'au',
  'asean',
  'g7', 'g20',
  'opec',
  'brics',
  'world trade organization', 'wto',
  'unhcr', 'un refugee agency',
  'world food programme', 'wfp',
  'icrc', 'red cross',
]);

/**
 * Organization types from the entity gazetteer that indicate significance.
 */
const SIGNIFICANT_ORG_TYPES = new Set([
  'international', 'military_alliance', 'humanitarian', 'financial',
]);

/**
 * Compute entity significance score (0-100) based on the presence of
 * heads of state, major organizations, or high-impact entity types.
 */
function computeEntitySignificance(entities) {
  if (!entities) return 0;

  let score = 0;

  // Check people for heads of state
  const people = entities.people || [];
  for (const person of people) {
    const name = person.name || '';
    for (const pattern of HEAD_OF_STATE_PATTERNS) {
      if (pattern.test(name)) {
        score += 35;
        break; // one match per person is enough
      }
    }
  }

  // Check organizations for major international bodies
  const orgs = entities.organizations || [];
  for (const org of orgs) {
    const name = (org.name || '').toLowerCase();
    const type = (org.type || '').toLowerCase();

    // Check by name
    if (SIGNIFICANT_ORG_NAMES.has(name)) {
      score += 30;
      continue;
    }

    // Check if org name contains a significant org name (e.g. "United Nations Security Council")
    let matched = false;
    for (const sigName of SIGNIFICANT_ORG_NAMES) {
      if (sigName.length >= 4 && name.includes(sigName)) {
        score += 30;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Check by type from gazetteer
    if (SIGNIFICANT_ORG_TYPES.has(type)) {
      score += 20;
      continue;
    }

    // Existing high-impact entity types (military, rebel, etc.) already handled in base model
  }

  return Math.min(100, score);
}

// ── Geographic clustering (conflict zones) ───────────────────────────────────

/**
 * Active conflict zones — countries with ongoing armed conflicts.
 * These get the highest geographic severity boost.
 */
const CONFLICT_ZONES = new Set([
  'SY', // Syria
  'UA', // Ukraine
  'YE', // Yemen
  'SD', // Sudan
  'SS', // South Sudan
  'MM', // Myanmar
  'CD', // DR Congo
  'SO', // Somalia
  'AF', // Afghanistan
  'LY', // Libya
  'IQ', // Iraq
  'ML', // Mali
  'BF', // Burkina Faso
  'NE', // Niger
  'MZ', // Mozambique (Cabo Delgado)
  'ET', // Ethiopia
  'HT', // Haiti
  'PS', // Palestine
]);

/**
 * Elevated tension zones — countries with political instability,
 * sanctions, or risk of escalation. Smaller boost than active conflicts.
 */
const TENSION_ZONES = new Set([
  'IR', // Iran
  'PK', // Pakistan
  'KP', // North Korea
  'VE', // Venezuela
  'LB', // Lebanon
  'TD', // Chad
  'CF', // Central African Republic
  'CM', // Cameroon
  'ER', // Eritrea
  'NG', // Nigeria
  'TW', // Taiwan (geopolitical tension)
  'RU', // Russia
  'CN', // China (geopolitical context)
  'IL', // Israel
]);

/**
 * Get a geographic severity boost based on whether the event's location
 * is in an active conflict zone or elevated tension zone.
 *
 * @param {string|null|undefined} isoA2 - ISO 3166-1 alpha-2 country code
 * @returns {number} Boost value (0 for peaceful, 4-8 for tension, 8-12 for conflict)
 */
function getConflictZoneBoost(isoA2) {
  if (!isoA2) return 0;
  const code = isoA2.toUpperCase();
  if (CONFLICT_ZONES.has(code)) return 10;
  if (TENSION_ZONES.has(code)) return 5;
  return 0;
}

// ── Historical baseline comparison ───────────────────────────────────────────

/**
 * Compute a severity adjustment based on how current regional activity
 * compares to the historical baseline.
 *
 * @param {number|null|undefined} ratio - Current activity / average activity.
 *   ratio > 1 means above-normal activity. ratio < 1 means below-normal.
 * @returns {number} Adjustment value (-3 to +8)
 */
function getBaselineAdjustment(ratio) {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return 0;

  if (ratio >= 3.0) return 8;   // 3x+ normal — significant anomaly
  if (ratio >= 2.0) return 6;   // 2x normal — notable spike
  if (ratio >= 1.5) return 4;   // 1.5x normal — elevated
  if (ratio >= 1.0) return 0;   // normal
  if (ratio >= 0.5) return -2;  // below normal — slightly reduce
  return -3;                     // well below normal
}

// ── Main composite severity function ─────────────────────────────────────────

export function computeCompositeSeverity(ctx) {
  // ── Base factors (existing model) ──
  const keywordScore = (ctx.keywordSeverity || 0) * 0.3;

  const corroboration = Math.min(100,
    Math.log2(Math.max(1, ctx.articleCount)) * (ctx.diversityScore || 0) * 25
  ) * 0.3;

  const highImpactCount = (ctx.entities?.organizations || [])
    .filter(o => HIGH_IMPACT_ENTITY_TYPES.has(o.type)).length;
  const entityScore = Math.min(100, highImpactCount * 40) * 0.2;

  const categoryWeight = CATEGORY_WEIGHTS[ctx.category] || CATEGORY_WEIGHTS.General;
  const typeScore = categoryWeight * 0.2;

  // ── New factor: Entity significance (heads of state, major orgs) ──
  const entitySignificance = computeEntitySignificance(ctx.entities);
  const significanceBoost = Math.min(12, entitySignificance * 0.12);

  // ── New factor: Geographic clustering (conflict zone boost) ──
  const conflictBoost = getConflictZoneBoost(ctx.isoA2);

  // ── New factor: Historical baseline comparison ──
  const baselineAdj = getBaselineAdjustment(ctx.regionalBaselineRatio);

  // ── Combine base score with velocity (if present) ──
  let baseScore;
  if (ctx.velocitySignal != null) {
    const velocityScore = Math.min(100, ctx.velocitySignal) * 0.2;
    const adjustedCorroboration = corroboration * (20 / 30);
    const adjustedType = typeScore * (10 / 20);
    baseScore = keywordScore + adjustedCorroboration + entityScore + adjustedType + velocityScore;
  } else {
    baseScore = keywordScore + corroboration + entityScore + typeScore;
  }

  // ── Apply additive boosts from new factors ──
  const finalScore = baseScore + significanceBoost + conflictBoost + baselineAdj;

  return Math.round(Math.min(100, Math.max(0, finalScore)));
}

// Export helpers for testing and reuse
export { computeEntitySignificance, getConflictZoneBoost, getBaselineAdjustment };
export { CONFLICT_ZONES, TENSION_ZONES };
