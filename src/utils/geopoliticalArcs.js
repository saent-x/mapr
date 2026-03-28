/**
 * Geopolitical Relationship Arcs
 *
 * Analyzes events to find which countries co-occur in stories and builds
 * weighted country-pair connections for visualization on the map.
 *
 * Uses multiple signals to detect co-occurrence:
 * 1. Events with multi-country `countries` arrays (direct co-occurrence)
 * 2. Shared entities (organizations/people) appearing in events from different countries
 *
 * Filtering:
 * - High-frequency global organization names (UN, NATO, EU, etc.) are excluded
 *   from entity co-occurrence to prevent false arcs between unrelated countries.
 * - Remaining entity pairs require title similarity (Jaccard > 0.15) to confirm
 *   topical relatedness.
 */

/**
 * Common global organizations that appear in many countries' news without
 * implying a genuine bilateral relationship. Mentions of these entities
 * are skipped when computing entity-based co-occurrence.
 */
export const HIGH_FREQUENCY_ENTITIES = new Set([
  'UN', 'United Nations',
  'NATO', 'North Atlantic Treaty Organization',
  'EU', 'European Union',
  'WHO', 'World Health Organization',
  'IMF', 'International Monetary Fund',
  'World Bank',
  'ASEAN', 'Association of Southeast Asian Nations',
  'AU', 'African Union',
  'ECOWAS', 'Economic Community of West African States',
  'G7', 'G8', 'G20',
  'ICC', 'International Criminal Court',
  'WTO', 'World Trade Organization',
  'UNICEF',
  'UNESCO',
  'UNHCR',
  'Red Cross', 'ICRC',
  'Amnesty International',
  'Human Rights Watch',
  'Doctors Without Borders', 'MSF',
  'Greenpeace',
  'Interpol',
  'OSCE',
  'BRICS',
  'OPEC',
]);

/**
 * Compute Jaccard token overlap between two title strings.
 * Tokenizes by splitting on non-word characters and filtering short tokens.
 *
 * @param {string} titleA - First title
 * @param {string} titleB - Second title
 * @returns {number} Jaccard similarity in [0, 1]
 */
export function jaccardTokenSimilarity(titleA, titleB) {
  if (!titleA || !titleB) return 0;
  const tokenize = (s) => new Set(s.toLowerCase().split(/\W+/).filter((t) => t.length > 1));
  const setA = tokenize(titleA);
  const setB = tokenize(titleB);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Add a co-occurrence pair to the pairs map.
 * @private
 */
function addPair(pairs, isoA, isoB, severity, eventId) {
  if (isoA === isoB) return;
  const [a, b] = [isoA, isoB].sort();
  const key = `${a}-${b}`;

  if (!pairs.has(key)) {
    pairs.set(key, {
      isoA: a,
      isoB: b,
      count: 0,
      totalSeverity: 0,
      maxSeverity: 0,
      storyIds: [],
    });
  }

  const entry = pairs.get(key);
  entry.count += 1;
  entry.totalSeverity += (severity || 0);
  entry.maxSeverity = Math.max(entry.maxSeverity, severity || 0);
  if (eventId && !entry.storyIds.includes(eventId)) entry.storyIds.push(eventId);
}

/**
 * Build a map of country-pair co-occurrences from a list of events.
 *
 * Uses multiple signals:
 * 1. Multi-country events (countries array with 2+ entries)
 * 2. Shared entities (orgs/people) that appear in events from different countries
 *
 * @param {Array} events - Array of event/article objects
 * @returns {Map<string, { isoA: string, isoB: string, count: number, maxSeverity: number, avgSeverity: number, storyIds: string[] }>}
 *   Keyed by sorted "ISO-ISO" pair key.
 */
export function buildCountryCoOccurrences(events) {
  const pairs = new Map();

  // 1. Direct multi-country co-occurrence from countries arrays
  for (const event of events) {
    const countries = event.countries;
    if (!Array.isArray(countries) || countries.length < 2) continue;

    const unique = [...new Set(countries)];
    if (unique.length < 2) continue;

    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        addPair(pairs, unique[i], unique[j], event.severity, event.id);
      }
    }
  }

  // 2. Shared entity co-occurrence: entities appearing in events from different countries
  // Check entities on events directly AND on their supportingArticles
  const entityCountryMap = {};
  for (const event of events) {
    if (!event.isoA2) continue;

    // Collect entities from the event itself and from its supporting articles
    const allEntities = [];
    if (event.entities) {
      allEntities.push(...(event.entities.organizations || []));
      allEntities.push(...(event.entities.people || []));
    }
    // Also check supportingArticles for entities (canonicalized events store articles)
    if (Array.isArray(event.supportingArticles)) {
      for (const article of event.supportingArticles) {
        if (!article.entities) continue;
        allEntities.push(...(article.entities.organizations || []));
        allEntities.push(...(article.entities.people || []));
      }
    }

    for (const entity of allEntities) {
      const name = entity.name || entity;
      if (!name || typeof name !== 'string' || name.length < 3) continue;
      // Skip high-frequency global organizations that cause false co-occurrence
      if (HIGH_FREQUENCY_ENTITIES.has(name)) continue;
      if (!entityCountryMap[name]) entityCountryMap[name] = [];
      entityCountryMap[name].push({
        iso: event.isoA2,
        severity: event.severity || 0,
        eventId: event.id,
        title: event.title || '',
      });
    }
  }

  for (const [, occurrences] of Object.entries(entityCountryMap)) {
    // Group by unique country
    const byCountry = {};
    for (const occ of occurrences) {
      if (!byCountry[occ.iso]) byCountry[occ.iso] = [];
      byCountry[occ.iso].push(occ);
    }
    const isos = Object.keys(byCountry);
    if (isos.length < 2) continue;

    // Create pairs between all countries sharing this entity,
    // but only include the SPECIFIC events whose titles pass the similarity check.
    for (let i = 0; i < isos.length; i++) {
      for (let j = i + 1; j < isos.length; j++) {
        const occsA = byCountry[isos[i]];
        const occsB = byCountry[isos[j]];

        // Compare each cross-country event pair individually.
        // Only events that participate in at least one passing pair are included.
        // If either event in a pair lacks a title, allow the pairing (be lenient).
        const matchedIds = new Set();
        const matchedOccs = [];
        for (const a of occsA) {
          for (const b of occsB) {
            const lenient = !a.title || !b.title;
            if (lenient || jaccardTokenSimilarity(a.title, b.title) > 0.15) {
              if (!matchedIds.has(a.eventId)) {
                matchedIds.add(a.eventId);
                matchedOccs.push(a);
              }
              if (!matchedIds.has(b.eventId)) {
                matchedIds.add(b.eventId);
                matchedOccs.push(b);
              }
            }
          }
        }

        for (const occ of matchedOccs) {
          addPair(pairs, isos[i], isos[j], occ.severity, occ.eventId);
        }
      }
    }
  }

  // Compute average severity and clean up
  for (const entry of pairs.values()) {
    entry.avgSeverity = entry.count > 0 ? Math.round(entry.totalSeverity / entry.count) : 0;
    delete entry.totalSeverity;
  }

  return pairs;
}

/**
 * Convert co-occurrence pairs into arc data suitable for map rendering.
 *
 * Resolves coordinates via a countryStoryMap (ISO → story with best coordinates)
 * and ranks by co-occurrence frequency.
 *
 * @param {Map} coOccurrences - From buildCountryCoOccurrences()
 * @param {Object} countryStoryMap - { [iso]: { coordinates, region, locality, ... } }
 * @param {Object} [options]
 * @param {number} [options.maxArcs=40] - Maximum arcs to return
 * @param {number} [options.minCount=1] - Minimum co-occurrence count to include
 * @returns {Array<Object>} Arc data objects
 */
export function buildGeopoliticalArcData(coOccurrences, countryStoryMap, options = {}) {
  const { maxArcs = 40, minCount = 1 } = options;

  const arcs = [];

  for (const [key, entry] of coOccurrences) {
    if (entry.count < minCount) continue;

    const storyA = countryStoryMap[entry.isoA];
    const storyB = countryStoryMap[entry.isoB];
    if (!storyA || !storyB) continue;

    arcs.push({
      id: key,
      startIso: entry.isoA,
      endIso: entry.isoB,
      startLat: storyA.coordinates[0],
      startLng: storyA.coordinates[1],
      endLat: storyB.coordinates[0],
      endLng: storyB.coordinates[1],
      startRegion: storyA.region || storyA.locality || entry.isoA,
      endRegion: storyB.region || storyB.locality || entry.isoB,
      count: entry.count,
      maxSeverity: entry.maxSeverity,
      avgSeverity: entry.avgSeverity,
      storyIds: entry.storyIds,
      type: 'geopolitical',
    });
  }

  // Sort by co-occurrence count descending, then by maxSeverity
  arcs.sort((a, b) => b.count - a.count || b.maxSeverity - a.maxSeverity);
  return arcs.slice(0, maxArcs);
}

/**
 * Map co-occurrence count to a stroke width for rendering.
 * Uses a sqrt scale to prevent extremely thick lines.
 *
 * @param {number} count - Co-occurrence count
 * @param {number} maxCount - Maximum count across all arcs
 * @returns {number} Stroke width (1 to 6)
 */
export function coOccurrenceToStroke(count, maxCount) {
  if (maxCount <= 0) return 1;
  const ratio = count / maxCount;
  return 1 + Math.sqrt(ratio) * 5; // 1–6 range
}

/**
 * Map co-occurrence count to a color (green → yellow → red gradient).
 *
 * @param {number} count - Co-occurrence count
 * @param {number} maxCount - Maximum count across all arcs
 * @returns {string} CSS color string
 */
export function coOccurrenceToColor(count, maxCount) {
  if (maxCount <= 0) return 'rgba(0, 212, 255, 0.6)';
  const ratio = Math.min(count / maxCount, 1);

  if (ratio < 0.33) {
    return 'rgba(0, 212, 255, 0.6)'; // Cyan — low co-occurrence
  } else if (ratio < 0.66) {
    return 'rgba(255, 170, 0, 0.7)'; // Amber — medium
  } else {
    return 'rgba(255, 85, 85, 0.8)'; // Red — high
  }
}

/**
 * Build the country-to-story lookup map.
 * Maps each ISO code to the highest-severity story with coordinates for that country.
 *
 * @param {Array} newsList - List of events/articles
 * @returns {Object} { [iso]: story }
 */
export function buildCountryStoryMap(newsList) {
  const map = {};
  for (const story of newsList) {
    if (!story.coordinates || !story.isoA2) continue;
    // Skip [0,0] coordinates
    if (story.coordinates[0] === 0 && story.coordinates[1] === 0) continue;
    if (!map[story.isoA2] || story.severity > map[story.isoA2].severity) {
      map[story.isoA2] = story;
    }
  }
  return map;
}
