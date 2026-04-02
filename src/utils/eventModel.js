// NOTE: This module uses node:crypto and must only be imported from server-side code or tests.
import { createHash } from 'node:crypto';
import { tokenizeHeadline } from './newsPipeline.js';

export const LIFECYCLE_STATES = ['resolved', 'escalating', 'stabilizing', 'developing', 'emerging'];

export function computeTopicFingerprint(articles) {
  const freq = {};
  for (const article of articles) {
    const tokens = tokenizeHeadline(article.title);
    for (const token of tokens) {
      freq[token] = (freq[token] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([token]) => token)
    .sort();
}

export function generateEventId(primaryCountry, topicTokens) {
  const input = primaryCountry + ':' + topicTokens.join(',');
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 16);
  return `evt-${hash}`;
}

const HOUR_MS = 60 * 60 * 1000;

export function computeLifecycleTransition(ctx) {
  const now = Date.now();
  const lastUpdatedMs = new Date(ctx.lastUpdatedAt).getTime();
  const firstSeenMs = new Date(ctx.firstSeenAt).getTime();
  const hoursSinceUpdate = (now - lastUpdatedMs) / HOUR_MS;
  const ageHours = (now - firstSeenMs) / HOUR_MS;

  if (hoursSinceUpdate >= 24) return 'resolved';

  if (ctx.lifecycle === 'developing' &&
      ctx.prevWindowArticleCount > 0 &&
      ctx.currWindowArticleCount >= ctx.prevWindowArticleCount * 1.5) {
    return 'escalating';
  }

  if ((ctx.lifecycle === 'escalating' || ctx.lifecycle === 'developing') &&
      hoursSinceUpdate >= 6) {
    return 'stabilizing';
  }

  if (ctx.articleCount >= 3 || ageHours > 2) return 'developing';

  return 'emerging';
}
