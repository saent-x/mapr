import { tokenizeHeadline, jaccardSimilarity } from '../src/utils/newsPipeline.js';
import { generateEventId, computeTopicFingerprint } from '../src/utils/eventModel.js';
import { classifySourceType } from '../src/utils/sourceMetadata.js';

const JACCARD_THRESHOLD = 0.25;
const MATCH_WINDOW_HOURS = 72;
const ENTITY_MATCH_WINDOW_HOURS = 24;

/**
 * Compute entity overlap between an article's entities and an event's entities.
 * Returns a score between 0 and 1 based on shared people and organizations.
 *
 * @param {Object|null} articleEntities - { people: [{name}], organizations: [{name}] }
 * @param {Object|null} eventEntities - { people: [{name}], organizations: [{name}] }
 * @returns {number} Overlap score 0-1
 */
export function computeEntityOverlap(articleEntities, eventEntities) {
  if (!articleEntities || !eventEntities) return 0;

  const articlePeople = (articleEntities.people || []).map(p => p.name.toLowerCase());
  const eventPeople = (eventEntities.people || []).map(p => p.name.toLowerCase());
  const articleOrgs = (articleEntities.organizations || []).map(o => o.name.toLowerCase());
  const eventOrgs = (eventEntities.organizations || []).map(o => o.name.toLowerCase());

  const allArticleEntities = [...articlePeople, ...articleOrgs];
  const allEventEntities = [...eventPeople, ...eventOrgs];

  if (allArticleEntities.length === 0 || allEventEntities.length === 0) return 0;

  const eventSet = new Set(allEventEntities);
  let sharedCount = 0;
  for (const entity of allArticleEntities) {
    if (eventSet.has(entity)) sharedCount++;
  }

  if (sharedCount === 0) return 0;

  // Jaccard-style: shared / union
  const unionSize = new Set([...allArticleEntities, ...allEventEntities]).size;
  return unionSize > 0 ? sharedCount / unionSize : 0;
}

/**
 * Compute temporal proximity bonus. Articles closer in time get a higher bonus.
 * Returns 0-1 where 1 means same time and 0 means at/beyond the window edge.
 *
 * @param {string} articlePublishedAt - ISO date string
 * @param {string} eventLastUpdatedAt - ISO date string
 * @param {number} windowHours - Maximum window in hours
 * @returns {number} Proximity score 0-1
 */
function computeTemporalProximity(articlePublishedAt, eventLastUpdatedAt, windowHours) {
  const articleTime = new Date(articlePublishedAt).getTime();
  const eventTime = new Date(eventLastUpdatedAt).getTime();
  const diffHours = Math.abs(articleTime - eventTime) / (60 * 60 * 1000);
  if (diffHours >= windowHours) return 0;
  return 1 - (diffHours / windowHours);
}

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

    // Topic fingerprint similarity (existing logic)
    const topicScore = jaccardSimilarity(articleTokens, event.topicFingerprint);

    // Entity overlap score (new)
    const entityScore = computeEntityOverlap(article.entities, event.entities);

    // Temporal proximity bonus (new) — closer articles score higher
    const temporalProximity = computeTemporalProximity(
      article.publishedAt, event.lastUpdatedAt, ENTITY_MATCH_WINDOW_HOURS
    );

    // Combined scoring:
    // - Topic similarity alone can match (>= JACCARD_THRESHOLD)
    // - Entity overlap with temporal proximity can also trigger a match
    // - Entity overlap gets a temporal bonus: stronger match when articles are close in time
    const entityWithTemporalBonus = entityScore * (0.5 + 0.5 * temporalProximity);
    const combinedScore = topicScore * 0.6 + entityWithTemporalBonus * 0.4;

    // Match if:
    // 1. Topic similarity alone is above threshold (original behavior), OR
    // 2. Combined score (topic + entity overlap) is above threshold, OR
    // 3. Strong entity overlap within 24h window (entity-driven grouping)
    const topicMatch = topicScore >= JACCARD_THRESHOLD;
    const combinedMatch = combinedScore >= JACCARD_THRESHOLD;
    const entityTemporalMatch = entityScore >= 0.3 && temporalProximity > 0;

    if ((topicMatch || combinedMatch || entityTemporalMatch) && combinedScore > bestScore) {
      // Prefer the stronger combined score to avoid choosing a weaker match
      bestMatch = event;
      bestScore = combinedScore;
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

/**
 * Collect a single article's entities into the event entities accumulator.
 * Updates people, organizations, and locations in-place.
 */
function mergeArticleEntities(event, article) {
  if (!article.entities) return;
  if (!event.entities) {
    event.entities = { people: [], organizations: [], locations: [] };
  }

  const ent = event.entities;

  for (const p of article.entities.people || []) {
    const key = p.name.toLowerCase();
    const existing = ent.people.find(e => e.name.toLowerCase() === key);
    if (existing) {
      existing.mentionCount = (existing.mentionCount || 1) + 1;
    } else {
      ent.people.push({ name: p.name, mentionCount: 1 });
    }
  }

  for (const o of article.entities.organizations || []) {
    const key = o.name.toLowerCase();
    const existing = ent.organizations.find(e => e.name.toLowerCase() === key);
    if (existing) {
      existing.mentionCount = (existing.mentionCount || 1) + 1;
    } else {
      ent.organizations.push({ name: o.name, type: o.type, mentionCount: 1 });
    }
  }

  for (const l of article.entities.locations || []) {
    const key = l.name.toLowerCase();
    const existing = ent.locations.find(e => e.name.toLowerCase() === key);
    if (existing) {
      existing.mentionCount = (existing.mentionCount || 1) + 1;
    } else {
      ent.locations.push({ name: l.name, mentionCount: 1 });
    }
  }
}

export function mergeArticlesIntoEvents(articles, existingEvents) {
  const events = existingEvents.map(e => ({
    ...e,
    articleIds: [...(e.articleIds || [])],
    entities: e.entities ? {
      people: [...(e.entities.people || [])],
      organizations: [...(e.entities.organizations || [])],
      locations: [...(e.entities.locations || [])]
    } : { people: [], organizations: [], locations: [] }
  }));
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
      // Update event entities with this article's entities
      mergeArticleEntities(match, article);
    } else {
      const fp = computeTopicFingerprint([article]);
      const id = generateEventId(article.isoA2, fp);
      const newEvent = {
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
        sourceTypes: [],
        entities: { people: [], organizations: [], locations: [] }
      };
      // Populate initial entities from first article
      mergeArticleEntities(newEvent, article);
      newEvents.push(newEvent);
    }
  }

  return [...events, ...newEvents];
}
