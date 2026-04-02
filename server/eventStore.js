import { tokenizeHeadline, jaccardSimilarity } from '../src/utils/newsPipeline.js';
import { generateEventId, computeTopicFingerprint } from '../src/utils/eventModel.js';
import { classifySourceType } from '../src/utils/sourceMetadata.js';

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

export function aggregateEntities(articles) {
  const people = {};
  const organizations = {};
  const locations = {};
  for (const article of articles) {
    if (!article.entities) continue;
    for (const p of article.entities.people || []) {
      people[p.name] = people[p.name] || { name: p.name, mentionCount: 0 };
      people[p.name].mentionCount++;
    }
    for (const o of article.entities.organizations || []) {
      organizations[o.name] = organizations[o.name] || { name: o.name, type: o.type, mentionCount: 0 };
      organizations[o.name].mentionCount++;
    }
    for (const l of article.entities.locations || []) {
      locations[l.name] = locations[l.name] || { name: l.name, mentionCount: 0 };
      locations[l.name].mentionCount++;
    }
  }
  return {
    people: Object.values(people).sort((a, b) => b.mentionCount - a.mentionCount),
    organizations: Object.values(organizations).sort((a, b) => b.mentionCount - a.mentionCount),
    locations: Object.values(locations).sort((a, b) => b.mentionCount - a.mentionCount)
  };
}

export function computeSourceProfile(articles) {
  const types = new Set();
  const counts = { wire: 0, independent: 0, state: 0, ngo: 0 };
  for (const article of articles) {
    const type = classifySourceType(article);
    types.add(type);
    if (type === 'wire') counts.wire++;
    else if (type === 'official') counts.ngo++;
    else if (type === 'global' || type === 'regional') counts.independent++;
    else counts.state++; // default bucket
  }
  return {
    wireCount: counts.wire,
    independentCount: counts.independent,
    stateMediaCount: counts.state,
    ngoCount: counts.ngo,
    diversityScore: Math.min(1, types.size / 4)
  };
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
        sourceTypes: []
      });
    }
  }

  return [...events, ...newEvents];
}
