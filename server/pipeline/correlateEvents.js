/**
 * Pipeline Stage 6: Event Correlation
 *
 * Merges articles into events, updates event lifecycles, computes
 * severity scores, aggregates entities, and detects amplification.
 */

import {
  readActiveEvents,
  readEventArticles,
  upsertEvent,
  linkArticlesToEvent,
  updateSourceCredibility
} from '../storage.js';
import { mergeArticlesIntoEvents, aggregateEntities, computeSourceProfile } from '../eventStore.js';
import { computeLifecycleTransition } from '../../src/utils/eventModel.js';
import { computeCompositeSeverity } from '../../src/utils/severityModel.js';
import { detectAmplification } from '../../src/utils/amplificationDetector.js';
import { getSourceNetworkKey } from '../../src/utils/sourceMetadata.js';

/**
 * Correlate articles into events and enrich each event.
 *
 * 1. Loads existing events from the database (last 72h)
 * 2. Merges new articles into events (by topic fingerprint + country)
 * 3. Persists each event (FK-safe ordering: event first, then links)
 * 4. Updates lifecycle transitions based on article velocity
 * 5. Computes entity aggregation, source profiles, severity, amplification, confidence
 *
 * @param {Object} options
 * @param {Array} options.articles - All merged articles for this ingest cycle
 * @param {Array} options.velocitySpikes - Current velocity spikes for severity adjustment
 * @returns {Promise<Array>} Enriched events array
 */
export async function correlateAndEnrichEvents({ articles, velocitySpikes }) {
  // Load existing events from DB (only last 72h)
  const existingEvents = await readActiveEvents({ maxAgeHours: 72 });

  // Merge new articles into events
  const mergedEvents = mergeArticlesIntoEvents(articles, existingEvents);

  console.log(`[ingest] Processing ${mergedEvents.length} events...`);
  let eventIdx = 0;

  for (const event of mergedEvents) {
    eventIdx++;
    if (eventIdx % 200 === 0) console.log(`[ingest]   event ${eventIdx}/${mergedEvents.length}`);

    // Persist the event first so FK constraints are satisfied for new events
    await upsertEvent({
      id: event.id,
      title: event.title,
      primaryCountry: event.primaryCountry,
      countries: event.countries,
      lifecycle: event.lifecycle ?? 'emerging',
      severity: event.severity ?? 0,
      category: event.category ?? null,
      firstSeenAt: event.firstSeenAt,
      lastUpdatedAt: event.lastUpdatedAt,
      topicFingerprint: event.topicFingerprint,
      coordinates: event.coordinates,
      enrichment: '{}'
    });

    // Link articles to event (event exists in DB, per-row FK errors handled inside)
    await linkArticlesToEvent(event.id, event.articleIds);

    // Get ALL articles for this event (from DB, not just current batch)
    const allEventArticles = await readEventArticles(event.id);

    // Compute lifecycle transition
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    const fourHoursAgo = now - 4 * 60 * 60 * 1000;
    const currWindow = allEventArticles.filter(a => new Date(a.publishedAt).getTime() >= twoHoursAgo).length;
    const prevWindow = allEventArticles.filter(a => {
      const t = new Date(a.publishedAt).getTime();
      return t >= fourHoursAgo && t < twoHoursAgo;
    }).length;

    event.lifecycle = computeLifecycleTransition({
      lifecycle: event.lifecycle,
      firstSeenAt: event.firstSeenAt,
      articleCount: event.articleIds.length,
      lastUpdatedAt: event.lastUpdatedAt,
      prevWindowArticleCount: prevWindow,
      currWindowArticleCount: currWindow
    });

    // Entity aggregation and source profile
    const sourceProfile = computeSourceProfile(allEventArticles);
    event.sourceProfile = sourceProfile;
    event.entities = aggregateEntities(allEventArticles);

    // Update source credibility based on corroboration
    const isCorroborated = allEventArticles.length >= 2 && sourceProfile.diversityScore > 0.3;
    for (const article of allEventArticles) {
      const sourceKey = getSourceNetworkKey(article);
      await updateSourceCredibility(sourceKey, isCorroborated);
    }

    // Use composite severity model
    const regionSpike = velocitySpikes.find(s => s.iso === event.primaryCountry);
    const severityCtx = {
      keywordSeverity: allEventArticles.length > 0
        ? Math.max(...allEventArticles.map(a => a.severity || 0))
        : (event.severity || 0),
      articleCount: allEventArticles.length,
      diversityScore: sourceProfile.diversityScore,
      entities: event.entities,
      category: event.nerCategory || event.category
    };
    if (regionSpike) {
      severityCtx.velocitySignal = Math.min(100, regionSpike.zScore * 30);
    }
    event.severity = computeCompositeSeverity(severityCtx);

    // Run amplification detection
    const amplification = detectAmplification(allEventArticles);
    event.amplification = amplification;

    // Compute confidence
    const confidence = Math.min(1, Math.max(0,
      (sourceProfile.diversityScore * 0.4) +
      (Math.min(1, Math.log2(Math.max(1, allEventArticles.length)) / 4) * 0.35) +
      (sourceProfile.wireCount > 0 ? 0.15 : 0) +
      (amplification.isAmplified ? -0.2 : 0.1)
    ));
    event.confidence = Math.round(confidence * 100) / 100;
  }

  return mergedEvents;
}

/**
 * Persist the final enriched events to the database.
 *
 * @param {Array} events - Enriched events from correlateAndEnrichEvents
 * @returns {Promise<void>}
 */
export async function persistEnrichedEvents(events) {
  for (const event of events) {
    await upsertEvent({
      ...event,
      countries: event.countries,
      topicFingerprint: event.topicFingerprint,
      coordinates: event.coordinates,
      enrichment: JSON.stringify({
        entities: event.entities,
        sourceProfile: event.sourceProfile,
        confidence: event.confidence,
        amplification: event.amplification
      })
    });
  }
}
