/**
 * Silence detection — distinguish "no events" from "no information".
 *
 * Restricted-press countries are loaded from the RSF Press Freedom
 * dataset rather than a hard-coded 3-element list. Coverage is global
 * by design — the dataset includes 150+ countries across every region.
 *
 * Source: src/data/pressFreedom.json (RSF 2024). Surface
 * `getRestrictedCountryEvidence(iso)` in the UI tooltip so the user
 * can see WHY a region is treated as restricted.
 */

import pressFreedomData from '../data/pressFreedom.json' with { type: 'json' };

// Tiers `very-serious` and `serious` count as "limited press access" for
// the silence-detector. The boundary is the RSF threshold, not our opinion.
const RESTRICTED_TIERS = new Set(['very-serious']);

const RESTRICTED_INDEX = (() => {
  const map = new Map();
  for (const entry of pressFreedomData.countries || []) {
    if (RESTRICTED_TIERS.has(entry.tier)) {
      map.set(String(entry.iso || '').toUpperCase(), entry);
    }
  }
  return map;
})();

export function isRestrictedCountry(iso) {
  if (!iso) return false;
  return RESTRICTED_INDEX.has(String(iso).toUpperCase());
}

/**
 * Return the source citation for a restricted-country flag, or null.
 * Use in UI tooltips so the claim is auditable.
 */
export function getRestrictedCountryEvidence(iso) {
  if (!iso) return null;
  const entry = RESTRICTED_INDEX.get(String(iso).toUpperCase());
  if (!entry) return null;
  return {
    name: entry.name,
    rank: entry.rank,
    score: entry.score,
    tier: entry.tier,
    source: pressFreedomData.metadata?.source,
    sourceUrl: pressFreedomData.metadata?.url,
    version: pressFreedomData.metadata?.version,
  };
}

export function detectSilence({ iso, currentCount, rollingAverage, gdeltActive = false }) {
  if (currentCount === 0 && gdeltActive) {
    return { status: 'blind-spot' };
  }

  if (isRestrictedCountry(iso) && currentCount === 0) {
    return {
      status: 'limited-access',
      evidence: getRestrictedCountryEvidence(iso),
    };
  }

  if (rollingAverage > 0 && currentCount < rollingAverage * 0.3) {
    return { status: 'anomalous-silence' };
  }

  if (rollingAverage > 0 && currentCount < rollingAverage * 0.6) {
    return { status: 'sparse' };
  }

  return { status: 'covered' };
}

export function computeSilenceMap(regions) {
  const map = {};
  for (const region of regions) {
    map[region.iso] = detectSilence(region);
  }
  return map;
}
