import { tokenizeHeadline, jaccardSimilarity } from '../src/utils/newsPipeline.js';
import { generateEventId, computeTopicFingerprint } from '../src/utils/eventModel.js';

const JACCARD_THRESHOLD = 0.25;
const MATCH_WINDOW_HOURS = 72;

function findMatchingEvent(article, events) {
  const articleTokens = tokenizeHeadline(article.title);
  let bestMatch = null;
  let bestScore = 0;

  for (const event of events) {
    const articleCountry = article.isoA2;
    const sharesCountry = event.countries.includes(articleCountry) ||
                          event.primaryCountry === articleCountry;
    if (!sharesCountry) continue;

    const eventAge = Date.now() - new Date(event.lastUpdatedAt).getTime();
    if (eventAge > MATCH_WINDOW_HOURS * 60 * 60 * 1000) continue;

    const score = jaccardSimilarity(articleTokens, event.topicFingerprint);
    if (score >= JACCARD_THRESHOLD && score > bestScore) {
      bestMatch = event;
      bestScore = score;
    }
  }

  return bestMatch;
}

export function mergeArticlesIntoEvents(articles, existingEvents) {
  const events = existingEvents.map(e => ({ ...e, articleIds: [...(e.articleIds || [])] }));
  const newEvents = [];

  for (const article of articles) {
    const match = findMatchingEvent(article, [...events, ...newEvents]);
    if (match) {
      if (!match.articleIds.includes(article.id)) {
        match.articleIds.push(article.id);
      }
      if (new Date(article.publishedAt) > new Date(match.lastUpdatedAt)) {
        match.lastUpdatedAt = article.publishedAt;
      }
      if (article.isoA2 && !match.countries.includes(article.isoA2)) {
        match.countries.push(article.isoA2);
      }
    } else {
      const fp = computeTopicFingerprint([article]);
      const id = generateEventId(article.isoA2, fp);
      newEvents.push({
        id,
        title: article.title,
        primaryCountry: article.isoA2,
        countries: [article.isoA2],
        lifecycle: 'emerging',
        severity: article.severity || 0,
        category: article.category || 'General',
        firstSeenAt: article.publishedAt || new Date().toISOString(),
        lastUpdatedAt: article.publishedAt || new Date().toISOString(),
        topicFingerprint: fp,
        coordinates: article.coordinates || null,
        articleIds: [article.id],
        sourceTypes: new Set()
      });
    }
  }

  return [...events, ...newEvents];
}
