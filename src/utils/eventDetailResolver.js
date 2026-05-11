import { canonicalizeArticles } from './newsPipeline.js';

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function addUniqueEvent(target, seen, event) {
  if (!event || !event.id) return;
  const id = String(event.id);
  if (seen.has(id)) return;
  seen.add(id);
  target.push(event);
}

export function flattenHistoricalEventSummaries(historicalState) {
  if (!historicalState?.snapshots) return [];

  const articles = [];
  for (const snapshot of historicalState.snapshots) {
    const at = snapshot?.at || snapshot?.timestamp || null;
    for (const event of snapshot?.eventSummary || []) {
      const isoA2 = event.isoA2 || event.primaryCountry || event.countries?.[0] || '';
      articles.push({
        id: event.id,
        title: event.title || 'Untitled',
        severity: event.severity ?? 0,
        primaryCountry: event.primaryCountry || isoA2,
        isoA2,
        region: event.region || event.primaryCountry || isoA2,
        category: event.category || '',
        lifecycle: event.lifecycle || '',
        summary: event.summary || event.title || '',
        firstSeenAt: event.firstSeenAt || at,
        publishedAt: event.lastUpdatedAt || event.firstSeenAt || at || new Date(0).toISOString(),
        coordinates: event.coordinates || null,
        entities: event.entities || { organizations: [], people: [], locations: [] },
        source: event.source || 'Historical snapshot',
        url: event.url || '',
      });
    }
  }
  return articles;
}

function collectRegionBackfillEvents(regionBackfills) {
  if (!regionBackfills || typeof regionBackfills !== 'object') return [];
  return Object.values(regionBackfills).flatMap((entry) => (
    Array.isArray(entry?.events) ? entry.events : []
  ));
}

export function getEventDetailCandidates({
  liveNews = [],
  backendEvents = [],
  historicalState = null,
  regionBackfills = {},
} = {}) {
  const candidates = [];
  const seen = new Set();
  const rawLive = Array.isArray(liveNews) ? liveNews : [];
  const rawBackend = Array.isArray(backendEvents) ? backendEvents : [];
  const historicalArticles = flattenHistoricalEventSummaries(historicalState);
  const backfillEvents = collectRegionBackfillEvents(regionBackfills);

  const canonicalLive = isNonEmptyArray(rawLive) ? canonicalizeArticles(rawLive) : [];
  const canonicalHistorical = isNonEmptyArray(historicalArticles)
    ? canonicalizeArticles(historicalArticles)
    : [];

  for (const event of canonicalLive) addUniqueEvent(candidates, seen, event);
  for (const event of rawBackend) addUniqueEvent(candidates, seen, event);
  for (const event of rawLive) addUniqueEvent(candidates, seen, event);
  for (const event of canonicalHistorical) addUniqueEvent(candidates, seen, event);
  for (const event of historicalArticles) addUniqueEvent(candidates, seen, event);
  for (const event of backfillEvents) addUniqueEvent(candidates, seen, event);

  return candidates;
}

export function resolveEventById(events, id) {
  if (!id) return null;
  const idText = String(id);
  return (Array.isArray(events) ? events : []).find((event) => String(event?.id) === idText) || null;
}
