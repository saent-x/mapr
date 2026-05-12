import { getSourceNetworkKey } from './sourceMetadata.js';
import { tokenizeHeadline, jaccardSimilarity } from './newsPipeline.js';
import stateAffiliatedDataset from '../data/stateAffiliatedNetworks.json' with { type: 'json' };

const WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const MIN_ARTICLES = 5;
const MAX_NETWORKS = 2;
const MIN_JACCARD = 0.5;

// Build a (lower-cased name → group key) map from the dataset so that
// state-affiliated outlets across every region collapse into a single
// "network" — not just Russian state media. Coverage is intentionally
// global; see src/data/stateAffiliatedNetworks.json metadata for sources.
//
// `state-controlled` and `state-affiliated` collapse together for the
// amplification heuristic (both reflect the state position by design).
// `publicly-funded` (BBC/NHK/etc.) is NOT loaded here — those keep their
// own per-outlet identity via getSourceNetworkKey.
const STATE_NETWORK_OVERRIDES = (() => {
  const map = new Map();
  const flagged = new Set(['state-controlled', 'state-affiliated']);
  for (const entry of stateAffiliatedDataset.networks || []) {
    if (!flagged.has(entry.category)) continue;
    const groupKey = `state-media-${(entry.country || 'XX').toLowerCase()}`;
    const aliases = [entry.name, ...(entry.aliases || [])];
    for (const alias of aliases) {
      if (!alias) continue;
      map.set(String(alias).toLowerCase().trim(), groupKey);
    }
  }
  return map;
})();

/**
 * Test-only escape hatch — returns the live override map. Do NOT use in
 * production code; call resolveNetworkKey instead.
 */
export function _getStateNetworkOverrides() {
  return STATE_NETWORK_OVERRIDES;
}

function resolveNetworkKey(article) {
  const normalized = (article.source || '').toLowerCase().trim();
  if (STATE_NETWORK_OVERRIDES.has(normalized)) {
    return STATE_NETWORK_OVERRIDES.get(normalized);
  }
  // Try a hostname match too — some feeds use the URL as the source field.
  if (article.url) {
    try {
      const host = new URL(article.url).hostname.replace(/^www\./, '').toLowerCase();
      if (STATE_NETWORK_OVERRIDES.has(host)) return STATE_NETWORK_OVERRIDES.get(host);
    } catch { /* ignore malformed url */ }
  }
  return getSourceNetworkKey({ source: article.source, url: article.url });
}

/**
 * Detects coordinated amplification: 5+ articles within 30 minutes,
 * from ≤2 distinct source networks, with average pairwise Jaccard similarity ≥0.5.
 *
 * @param {Array<{ source: string, publishedAt: string, title: string }>} articles
 * @returns {{ isAmplified: boolean, networkCount: number, reason: string|null }}
 */
export function detectAmplification(articles) {
  if (!articles || articles.length < MIN_ARTICLES) {
    return { isAmplified: false, networkCount: 0, reason: null };
  }

  // Filter articles within the 30-minute window (relative to the most recent)
  const times = articles.map((a) => new Date(a.publishedAt).getTime());
  const maxTime = Math.max(...times);
  const minTime = maxTime - WINDOW_MS;

  const windowed = articles.filter((a) => {
    const t = new Date(a.publishedAt).getTime();
    return t >= minTime && t <= maxTime;
  });

  if (windowed.length < MIN_ARTICLES) {
    return { isAmplified: false, networkCount: 0, reason: null };
  }

  // Count distinct source networks
  const networks = new Set(windowed.map(resolveNetworkKey));
  const networkCount = networks.size;

  if (networkCount > MAX_NETWORKS) {
    return { isAmplified: false, networkCount, reason: null };
  }

  // Compute average pairwise Jaccard similarity
  const tokenized = windowed.map((a) => tokenizeHeadline(a.title));
  let totalSimilarity = 0;
  let pairCount = 0;

  for (let i = 0; i < tokenized.length; i++) {
    for (let j = i + 1; j < tokenized.length; j++) {
      totalSimilarity += jaccardSimilarity(tokenized[i], tokenized[j]);
      pairCount += 1;
    }
  }

  const avgSimilarity = pairCount > 0 ? totalSimilarity / pairCount : 0;

  if (avgSimilarity < MIN_JACCARD) {
    return { isAmplified: false, networkCount, reason: null };
  }

  return {
    isAmplified: true,
    networkCount,
    reason: `${windowed.length} articles from ${networkCount} network(s) within 30min with avg Jaccard ${avgSimilarity.toFixed(2)}`
  };
}
