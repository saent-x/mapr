/**
 * narrativeHelpers.js — Utilities for building a narrative timeline from an event's
 * supportingArticles.  Shows first report, subsequent sources, source diversity
 * (wire / local / regional / global / official), and cross-regional spread.
 */

import { classifySourceType } from './sourceMetadata.js';
import { tokenizeHeadline, jaccardSimilarity } from './newsPipeline.js';

/* ── source-type badge order (display left→right) ── */
const SOURCE_TYPE_ORDER = ['official', 'wire', 'global', 'regional', 'local', 'unknown'];

/**
 * Sort articles chronologically (earliest first).
 */
function sortByDate(articles) {
  return [...articles].sort(
    (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime()
  );
}

/**
 * Given an array of articles, group them into time-based stages.
 * Stage 0  = first report (the earliest article).
 * Stage 1+ = subsequent reports grouped into ~2-hour windows.
 */
export function buildTimelineStages(articles) {
  if (!articles || articles.length === 0) return [];

  const sorted = sortByDate(articles);
  const stages = [];
  const WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

  sorted.forEach((article) => {
    const ts = new Date(article.publishedAt).getTime();
    const sourceType = article.sourceType || classifySourceType(article);

    const entry = {
      ...article,
      sourceType,
      timestamp: ts,
    };

    if (stages.length === 0) {
      stages.push({ label: 'first', startTime: ts, articles: [entry] });
      return;
    }

    const lastStage = stages[stages.length - 1];
    if (ts - lastStage.startTime <= WINDOW_MS) {
      lastStage.articles.push(entry);
    } else {
      stages.push({
        label: stages.length === 1 ? 'developing' : 'continued',
        startTime: ts,
        articles: [entry],
      });
    }
  });

  return stages;
}

/**
 * Compute source-type diversity summary across timeline stages.
 * Returns an array of { type, count } sorted by SOURCE_TYPE_ORDER.
 */
export function computeSourceDiversity(articles) {
  if (!articles || articles.length === 0) return [];

  const counts = {};
  articles.forEach((article) => {
    const type = article.sourceType || classifySourceType(article);
    counts[type] = (counts[type] || 0) + 1;
  });

  return SOURCE_TYPE_ORDER
    .filter((type) => counts[type] > 0)
    .map((type) => ({ type, count: counts[type] }));
}

/**
 * Compute per-stage diversity — for each stage, return which source types reported.
 */
export function computeStageDiversity(stages) {
  return stages.map((stage) => {
    const types = new Set(stage.articles.map((a) => a.sourceType || classifySourceType(a)));
    return {
      label: stage.label,
      startTime: stage.startTime,
      articleCount: stage.articles.length,
      sourceTypes: SOURCE_TYPE_ORDER.filter((t) => types.has(t)),
    };
  });
}

/**
 * Given the selected event and all events in the current view, find events in
 * OTHER regions whose title is similar enough to constitute the same narrative.
 * Uses Jaccard similarity on tokenised headlines — same approach as the event
 * clustering pipeline but relaxed to cross-region.
 *
 * Returns an array of { event, similarity } sorted by descending similarity.
 */
export function findCrossRegionalSpread(selectedEvent, allEvents, threshold = 0.30) {
  if (!selectedEvent || !allEvents || allEvents.length === 0) return [];

  const selectedTokens = tokenizeHeadline(selectedEvent.title || '');
  if (selectedTokens.size === 0) return [];

  const selectedIso = selectedEvent.isoA2;

  return allEvents
    .filter((ev) => ev.isoA2 && ev.isoA2 !== selectedIso && ev.id !== selectedEvent.id)
    .map((ev) => {
      const tokens = tokenizeHeadline(ev.title || '');
      const similarity = jaccardSimilarity(selectedTokens, tokens);
      return { event: ev, similarity };
    })
    .filter((match) => match.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 10);
}

/**
 * Build the full narrative data object for a selected event.
 *
 * @param {Object} selectedEvent  – the expanded event/story
 * @param {Array}  allEvents      – all current events for cross-regional matching
 * @returns {{ stages, diversity, stageDiversity, crossRegional, firstReportedAt, timeSpan }}
 */
export function buildNarrativeTimeline(selectedEvent, allEvents) {
  const articles = selectedEvent?.supportingArticles || [];

  const stages = buildTimelineStages(articles);
  const diversity = computeSourceDiversity(articles);
  const stageDiversity = computeStageDiversity(stages);
  const crossRegional = findCrossRegionalSpread(selectedEvent, allEvents || []);

  const firstReportedAt = articles.length > 0
    ? new Date(Math.min(...articles.map((a) => new Date(a.publishedAt).getTime()))).toISOString()
    : selectedEvent?.firstSeenAt || null;

  const lastReportedAt = articles.length > 0
    ? new Date(Math.max(...articles.map((a) => new Date(a.publishedAt).getTime()))).toISOString()
    : selectedEvent?.lastSeenAt || null;

  const timeSpanMs = firstReportedAt && lastReportedAt
    ? new Date(lastReportedAt).getTime() - new Date(firstReportedAt).getTime()
    : 0;

  return {
    stages,
    diversity,
    stageDiversity,
    crossRegional,
    firstReportedAt,
    lastReportedAt,
    timeSpanMs,
  };
}
