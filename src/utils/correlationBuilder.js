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
} = {}) {
  if (!events || !Array.isArray(events) || events.length === 0) {
    return { lanes: [], correlations: [], timeRange: { min: Date.now(), max: Date.now() } };
  }

  const now = Date.now();
  const cutoff = now - maxAgeHours * 3600 * 1000;
  const q = entityFilter.toLowerCase().trim();

  // Filter events by time and severity and optional entity
  let filtered = events.filter((ev) => {
    const ts = ev.firstSeenAt ? new Date(ev.firstSeenAt).getTime() : null;
    if (!ts || ts < cutoff) return false;
    if ((ev.severity ?? 0) < minSeverity) return false;
    if (q && !eventContainsEntity(ev.entities, q)) return false;
    return true;
  });

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

  // Find cross-lane correlations: events in different lanes sharing entities
  const correlations = [];
  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) {
      const laneA = lanes[i];
      const laneB = lanes[j];
      for (const evA of laneA.events) {
        for (const evB of laneB.events) {
          if (eventsOverlap(evA.entities, evB.entities)) {
            const shared = sharedEntities(evA.entities, evB.entities);
            correlations.push({
              from: evA.id,
              to: evB.id,
              fromRegion: laneA.region,
              toRegion: laneB.region,
              sharedEntityNames: shared,
            });
          }
        }
      }
    }
  }

  return { lanes, correlations, timeRange: { min: tMin, max: tMax } };
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
