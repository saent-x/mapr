import { getSourceNetworkKey } from './sourceMetadata.js';
import { tokenizeHeadline, jaccardSimilarity } from './newsPipeline.js';

const WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const MIN_ARTICLES = 5;
const MAX_NETWORKS = 2;
const MIN_JACCARD = 0.5;

// Exact-match overrides for short/ambiguous source names that share a network
const EXACT_NETWORK_OVERRIDES = new Map([
  ['rt', 'russian-state-media'],
  ['tass', 'russian-state-media'],
  ['sputnik', 'russian-state-media'],
  ['ria novosti', 'russian-state-media'],
  ['rossiya', 'russian-state-media'],
  ['interfax', 'russian-state-media']
]);

function resolveNetworkKey(article) {
  const normalized = (article.source || '').toLowerCase().trim();
  if (EXACT_NETWORK_OVERRIDES.has(normalized)) {
    return EXACT_NETWORK_OVERRIDES.get(normalized);
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
