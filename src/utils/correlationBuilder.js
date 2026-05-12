import { HIGH_FREQUENCY_ENTITIES, jaccardTokenSimilarity } from './geopoliticalArcs.js';

/**
 * Event Correlation Timeline — utility to build lane and correlation data
 * from a set of events with entity metadata.
 *
 * Each lane represents a region (primaryCountry). Events are positioned
 * by timestamp along a horizontal temporal axis. Cross-lane lines connect
 * events that share at least one entity (person, organization, or location).
 */

/**
 * Collect all unique entity names from an event's entity block.
 * Used to test for shared entities across events.
 *
 * @param {Object|null} entities - Event entities object { people, organizations, locations }
 * @returns {Set<string>} Lowercased entity names
 */
export function collectEntityNames(entities) {
  const names = new Set();
  if (!entities) return names;
  const { people = [], organizations = [], locations = [] } = entities;
  for (const p of people) if (p.name) names.add(p.name.toLowerCase());
  for (const o of organizations) if (o.name) names.add(o.name.toLowerCase());
  for (const l of locations) if (l.name) names.add(l.name.toLowerCase());
  return names;
}

const ENTITY_TYPES = [
  ['people', 'person'],
  ['organizations', 'organization'],
];

const CORRELATION_ENTITY_DENYLIST = new Set([
  'AP', 'Associated Press', 'Reuters', 'BBC', 'BBC News', 'CNN', 'France 24',
  'Al Jazeera', 'The Guardian', 'New York Times', 'Washington Post',
  'Victory Day', 'Palestine Marathon', 'First Thing', 'Middle East',
  'United States', 'Estados Unidos',
]);

function normalizeEntityName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function isUsefulCorrelationEntity(type, name) {
  const normalized = normalizeEntityName(name);
  if (normalized.length < 4) return false;
  if (/[’']s$/i.test(normalized)) return false;
  if (normalized.split(/\s+/).length > 5) return false;
  if (/\s(and|y|et|و)\s/i.test(normalized)) return false;
  if (HIGH_FREQUENCY_ENTITIES.has(normalized)) return false;
  if (CORRELATION_ENTITY_DENYLIST.has(normalized)) return false;
  return true;
}

function collectCorrelationEntities(entities) {
  const map = new Map();
  if (!entities) return map;
  for (const [field, type] of ENTITY_TYPES) {
    const values = Array.isArray(entities[field]) ? entities[field] : [];
    for (const raw of values) {
      const name = normalizeEntityName(typeof raw === 'string' ? raw : raw?.name);
      if (!isUsefulCorrelationEntity(type, name)) continue;
      const key = `${type}:${name.toLowerCase()}`;
      map.set(key, { key, name, type });
    }
  }
  return map;
}

function getSharedCorrelationEntities(a, b) {
  const entitiesA = collectCorrelationEntities(a);
  const entitiesB = collectCorrelationEntities(b);
  const shared = [];
  for (const [key, entity] of entitiesA) {
    if (entitiesB.has(key)) shared.push(entity);
  }
  return shared;
}

function shouldCorrelateEvents(evA, evB, shared) {
  if (!shared.length) return false;
  const hasNamedActor = shared.some((entity) => entity.type === 'person' || entity.type === 'organization');
  const topicalSimilarity = jaccardTokenSimilarity(evA.title || evA.summary || '', evB.title || evB.summary || '');
  if (hasNamedActor) return topicalSimilarity >= 0.12 || (shared.length >= 2 && topicalSimilarity >= 0.08);
  return topicalSimilarity >= 0.2;
}

/**
 * Check whether two event entity sets share at least one entity.
 *
 * @param {Object|null} a - First event's entities
 * @param {Object|null} b - Second event's entities
 * @returns {boolean}
 */
export function eventsOverlap(a, b) {
  const namesA = collectEntityNames(a);
  const namesB = collectEntityNames(b);
  for (const n of namesA) {
    if (namesB.has(n)) return true;
  }
  return false;
}

/**
 * Get shared entity names between two entity sets.
 *
 * @param {Object|null} a - First event's entities
 * @param {Object|null} b - Second event's entities
 * @returns {string[]} Lowercased shared entity names
 */
export function sharedEntities(a, b) {
  const namesA = collectEntityNames(a);
  const namesB = collectEntityNames(b);
  const shared = [];
  for (const n of namesA) {
    if (namesB.has(n)) shared.push(n);
  }
  return shared;
}

/**
 * Check if an event's entities contain a given entity name.
 *
 * @param {Object|null} entities - Event entities object
 * @param {string} query - Entity name to search for (lowercased)
 * @returns {boolean}
 */
export function eventContainsEntity(entities, query) {
  const names = collectEntityNames(entities);
  for (const n of names) {
    if (n.includes(query)) return true;
  }
  return false;
}

/**
 * Build correlation timeline data from events.
 *
 * @param {Array} events - Array of event objects with: id, title, primaryCountry,
 *   entities, severity, firstSeenAt, lifecycle, coordinates, category
 * @param {Object} options
 * @param {number} [options.maxAgeHours=720] - Only include events within this many hours
 * @param {number} [options.minSeverity=0] - Minimum severity threshold
 * @param {string} [options.entityFilter] - Lowercased entity name filter
 * @returns {{ lanes: Array, correlations: Array, timeRange: { min, max } }}
 */
export function buildCorrelationData(events, {
  maxAgeHours = 720,    // 30 days default
  minSeverity = 0,
  entityFilter = '',
  maxEvents = 500,
  maxCorrelations = 800,
  maxEntityRegions = 8,
  maxEntityEvents = 40,
} = {}) {
  if (!events || !Array.isArray(events) || events.length === 0) {
    return { lanes: [], correlations: [], timeRange: { min: Date.now(), max: Date.now() } };
  }

  const now = Date.now();
  const cutoff = now - maxAgeHours * 3600 * 1000;
  const q = entityFilter.toLowerCase().trim();

  // Filter events by time and severity and optional entity.
  let filtered = events.filter((ev) => {
    const ts = ev.firstSeenAt ? new Date(ev.firstSeenAt).getTime() : null;
    if (!ts || ts < cutoff) return false;
    if ((ev.severity ?? 0) < minSeverity) return false;
    if (q && !eventContainsEntity(ev.entities, q)) return false;
    return true;
  });

  // Keep the chart responsive on large live pools. Prefer recent, high-signal
  // events and let filters expose narrower timelines when needed.
  if (filtered.length > maxEvents) {
    filtered = filtered
      .sort((a, b) => {
        const sb = b.severity ?? 0;
        const sa = a.severity ?? 0;
        if (sb !== sa) return sb - sa;
        return new Date(b.firstSeenAt || 0).getTime() - new Date(a.firstSeenAt || 0).getTime();
      })
      .slice(0, maxEvents);
  }

  if (filtered.length === 0) {
    return { lanes: [], correlations: [], timeRange: { min: now, max: now } };
  }

  // Determine time range from filtered events
  const timestamps = filtered.map((ev) => new Date(ev.firstSeenAt).getTime());
  const tMin = Math.min(...timestamps);
  const tMax = Math.max(...timestamps);

  // Group events by primaryCountry into lanes
  const laneMap = new Map();
  for (const ev of filtered) {
    const region = ev.primaryCountry || ev.isoA2 || 'Unknown';
    if (!laneMap.has(region)) {
      laneMap.set(region, []);
    }
    laneMap.get(region).push(ev);
  }

  // Sort each lane's events by time and build lane objects
  const lanes = [];
  for (const [region, evs] of laneMap) {
    evs.sort((a, b) => {
      const ta = a.firstSeenAt ? new Date(a.firstSeenAt).getTime() : 0;
      const tb = b.firstSeenAt ? new Date(b.firstSeenAt).getTime() : 0;
      return ta - tb;
    });
    lanes.push({ region, events: evs });
  }

  // Sort lanes by earliest event (so most active regions are at top)
  lanes.sort((a, b) => {
    const ta = a.events.length > 0 ? new Date(a.events[0].firstSeenAt).getTime() : 0;
    const tb = b.events.length > 0 ? new Date(b.events[0].firstSeenAt).getTime() : 0;
    return ta - tb;
  });

  const eventRegion = new Map();
  const eventEntities = new Map();
  for (const lane of lanes) {
    for (const ev of lane.events) {
      eventRegion.set(ev.id, lane.region);
      eventEntities.set(ev.id, collectCorrelationEntities(ev.entities));
    }
  }

  // Find cross-lane correlations through an entity index instead of comparing
  // every event pair. This keeps the timeline usable for live datasets.
  const correlations = [];
  const seenPairs = new Set();
  const byEntity = new Map();
  for (const ev of filtered) {
    for (const [key] of eventEntities.get(ev.id) || []) {
      if (!byEntity.has(key)) byEntity.set(key, []);
      byEntity.get(key).push(ev);
    }
  }

  for (const [entityKey, entityEvents] of byEntity) {
    const entityRegions = new Set(entityEvents.map((event) => eventRegion.get(event.id)).filter(Boolean));
    if (entityEvents.length > maxEntityEvents || entityRegions.size > maxEntityRegions) continue;
    for (let i = 0; i < entityEvents.length; i++) {
      for (let j = i + 1; j < entityEvents.length; j++) {
        const evA = entityEvents[i];
        const evB = entityEvents[j];
        const regionA = eventRegion.get(evA.id);
        const regionB = eventRegion.get(evB.id);
        if (!regionA || !regionB || regionA === regionB) continue;
        const key = evA.id < evB.id ? `${evA.id}|${evB.id}` : `${evB.id}|${evA.id}`;
        if (seenPairs.has(key)) continue;
        const shared = getSharedCorrelationEntities(evA.entities, evB.entities);
        if (!shouldCorrelateEvents(evA, evB, shared)) continue;
        seenPairs.add(key);
        const titleSimilarity = jaccardTokenSimilarity(evA.title || evA.summary || '', evB.title || evB.summary || '');
        correlations.push({
          from: evA.id,
          to: evB.id,
          fromRegion: regionA,
          toRegion: regionB,
          sharedEntityNames: shared.length ? shared.map((entity) => entity.name) : [entityKey],
          sharedEntities: shared,
          titleSimilarity,
          score: shared.length * 2 + titleSimilarity * 5 + ((evA.severity || 0) + (evB.severity || 0)) / 100,
        });
        if (correlations.length >= maxCorrelations) {
          return { lanes, correlations, timeRange: { min: tMin, max: tMax } };
        }
      }
    }
  }

  return { lanes, correlations, timeRange: { min: tMin, max: tMax } };
}

export function buildCorrelationInsights(correlations = [], eventMap = new Map(), { limit = 6 } = {}) {
  const regionPairs = new Map();
  const entityClusters = new Map();

  for (const correlation of correlations) {
    const pairKey = [correlation.fromRegion, correlation.toRegion].sort().join(' ↔ ');
    const pair = regionPairs.get(pairKey) || {
      key: pairKey,
      fromRegion: correlation.fromRegion,
      toRegion: correlation.toRegion,
      linkCount: 0,
      avgSeverity: 0,
      score: 0,
      sharedEntities: new Map(),
      examples: [],
    };

    const fromEvent = eventMap.get(correlation.from);
    const toEvent = eventMap.get(correlation.to);
    const severity = ((fromEvent?.severity || 0) + (toEvent?.severity || 0)) / 2;
    pair.linkCount += 1;
    pair.avgSeverity += severity;
    pair.score += correlation.score || 1;
    for (const entity of correlation.sharedEntities || []) {
      pair.sharedEntities.set(entity.key || entity.name, entity);
      const cluster = entityClusters.get(entity.key || entity.name) || {
        key: entity.key || entity.name,
        name: entity.name,
        type: entity.type || 'entity',
        linkCount: 0,
        regions: new Set(),
        examples: [],
      };
      cluster.linkCount += 1;
      cluster.regions.add(correlation.fromRegion);
      cluster.regions.add(correlation.toRegion);
      if (fromEvent?.title && cluster.examples.length < 2) cluster.examples.push(fromEvent.title);
      entityClusters.set(cluster.key, cluster);
    }
    if (fromEvent?.title && pair.examples.length < 2) pair.examples.push(fromEvent.title);
    if (toEvent?.title && pair.examples.length < 2) pair.examples.push(toEvent.title);
    regionPairs.set(pairKey, pair);
  }

  const topRegionPairs = [...regionPairs.values()]
    .map((pair) => ({
      ...pair,
      avgSeverity: pair.linkCount ? pair.avgSeverity / pair.linkCount : 0,
      sharedEntities: [...pair.sharedEntities.values()].slice(0, 4),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const topEntities = [...entityClusters.values()]
    .map((cluster) => ({
      ...cluster,
      regions: [...cluster.regions].sort(),
    }))
    .sort((a, b) => {
      if (b.linkCount !== a.linkCount) return b.linkCount - a.linkCount;
      return b.regions.length - a.regions.length;
    })
    .slice(0, limit);

  return { topRegionPairs, topEntities };
}

/**
 * Get severity color matching MAPR's severity tiers.
 *
 * @param {number} sev - Severity score 0-100
 * @returns {string} CSS color variable
 */
export function severityColor(sev) {
  if (sev >= 70) return 'var(--sev-red)';
  if (sev >= 40) return 'var(--sev-amber)'; // elevated
  if (sev >= 20) return 'var(--amber)';      // watch
  return 'var(--sev-green)';                   // low
}

/**
 * Format a timestamp into a compact label.
 *
 * @param {number} ts - Unix timestamp (ms)
 * @returns {string} Formatted date-time label
 */
export function formatCorrelationTimestamp(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${min}`;
}
