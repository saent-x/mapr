/**
 * Pipeline Stage 6: Event Correlation
 *
 * Merges articles into events, updates event lifecycles, computes
 * severity scores, aggregates entities, and detects amplification.
 */

import {
  readActiveEvents,
  readEventArticles,
  readEventArticlesBatch,
  upsertEvent,
  linkArticlesToEvent,
  updateSourceCredibilityBatch
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

  // Accumulate per-source credibility counters across the cycle so we can
  // flush a single batched upsert at the end (was N+1: one query per
  // article per event, hundreds of round-trips on the hot path).
  const credibilityAcc = new Map();

  // Phase 1: persist all events + link articles. We must do this before
  // we can readEventArticlesBatch, since the FK side has to exist.
  for (const event of mergedEvents) {
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
    try {
      const linkRes = await linkArticlesToEvent(event.id, event.articleIds);
      if (linkRes?.dropped > 0) {
        console.warn('[ingest] articles dropped (FK)', { eventId: event.id, dropped: linkRes.dropped });
      }
    } catch (linkErr) {
      if (linkErr?.code === '23503') {
        console.warn('[ingest] FK violation linking event', event.id);
      } else {
        console.error('[ingest] linkArticlesToEvent failed for event', event.id, ':', linkErr.message);
      }
    }
  }

  // Phase 2: ONE batched read of every event's articles, instead of N
  // separate readEventArticles calls in the enrichment loop.
  const articlesByEvent = await readEventArticlesBatch(mergedEvents.map((e) => e.id));
  function bumpCredibility(sourceKey, isCorroborated) {
    if (!sourceKey) return;
    const cur = credibilityAcc.get(sourceKey) || { total: 0, corroborated: 0 };
    cur.total += 1;
    if (isCorroborated) cur.corroborated += 1;
    credibilityAcc.set(sourceKey, cur);
  }

  // Phase 3: enrich each event using the batch-prefetched articles map.
  for (const event of mergedEvents) {
    eventIdx++;
    if (eventIdx % 200 === 0) console.log(`[ingest]   event ${eventIdx}/${mergedEvents.length}`);

    // Get ALL articles for this event (from DB, not just current batch).
    // Prefer the batch-cache prefetched outside the loop; fall back to a
    // single-event query for any cache miss (rare race with new rows).
    const allEventArticles = articlesByEvent?.get(event.id) || await readEventArticles(event.id);

    // Compute lifecycle transition
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    const fourHoursAgo = now - 4 * 60 * 60 * 1000;
    const currWindow = allEventArticles.filter((a) => {
      const t = new Date(a.publishedAt).getTime();
      return Number.isFinite(t) && t >= twoHoursAgo;
    }).length;
    const prevWindow = allEventArticles.filter((a) => {
      const t = new Date(a.publishedAt).getTime();
      return Number.isFinite(t) && t >= fourHoursAgo && t < twoHoursAgo;
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

    // Accumulate source credibility — flushed in a single batched query
    // after the loop, replacing the previous N+1 await-per-article pattern.
    const isCorroborated = allEventArticles.length >= 2 && sourceProfile.diversityScore > 0.3;
    for (const article of allEventArticles) {
      bumpCredibility(getSourceNetworkKey(article), isCorroborated);
    }

    // Use composite severity model with entity significance, conflict zones, and baseline
    const regionSpike = velocitySpikes.find(s => s.iso === event.primaryCountry);
    const severityCtx = {
      keywordSeverity: allEventArticles.length > 0
        ? Math.max(...allEventArticles.map(a => a.severity || 0))
        : (event.severity || 0),
      articleCount: allEventArticles.length,
      diversityScore: sourceProfile.diversityScore,
      entities: event.entities,
      category: event.nerCategory || event.category,
      isoA2: event.primaryCountry || null
    };
    if (regionSpike) {
      // zScore is already clamped in velocityTracker.js, but guard against
      // NaN propagating from upstream code paths that haven't been migrated.
      const z = Number.isFinite(regionSpike.zScore) ? regionSpike.zScore : 0;
      severityCtx.velocitySignal = Math.min(100, Math.max(0, z * 30));
      // z-score of 2 means ~2x normal activity (assuming std ≈ mean/2)
      severityCtx.regionalBaselineRatio = 1 + Math.max(0, z * 0.5);
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
    event.confidence = Math.round(confidence * 100);
  }

  // Flush accumulated source-credibility deltas in one round-trip.
  if (credibilityAcc.size > 0) {
    try {
      await updateSourceCredibilityBatch(credibilityAcc);
    } catch (err) {
      console.error('[ingest] credibility batch failed:', err.message);
    }
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
