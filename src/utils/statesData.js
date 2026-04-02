/**
 * Admin-1 subdivisions (states, provinces, regions, etc.) for every country.
 * Data sourced from Natural Earth (ne_10m_admin_1_states_provinces).
 * 240 countries, ~4,577 subdivisions.
 *
 * City-to-state mapping from Natural Earth populated places.
 * 179 countries, ~7,148 city→state mappings.
 */
import admin1Data from '../assets/admin1-centroids.json';
import cityToState from '../assets/city-to-state.json';

/**
 * Return all admin-1 subdivisions for a given ISO-A2 country code.
 * @param {string} iso — e.g. "NG" for Nigeria
 * @returns {Array<{ name: string, lat: number, lng: number, type: string }>}
 */
export function getStatesByIso(iso) {
  if (!iso) return [];
  const entries = admin1Data[iso.toUpperCase()];
  if (!entries) return [];
  return entries.map((e) => ({ name: e.n, lat: e.la, lng: e.lo, type: e.t }));
}

/**
 * Look up which state/province a city belongs to.
 * @param {string} iso — country ISO-A2
 * @param {string} cityName — e.g. "Jos"
 * @returns {string|null} state name e.g. "Plateau"
 */
function cityToStateName(iso, cityName) {
  if (!iso || !cityName) return null;
  const countryMap = cityToState[iso.toUpperCase()];
  if (!countryMap) return null;
  return countryMap[cityName.toLowerCase()] || null;
}

/**
 * Find a state entry by name within a country's admin-1 data.
 */
function findStateEntry(iso, stateName) {
  if (!stateName) return null;
  const entries = admin1Data[iso.toUpperCase()];
  if (!entries) return null;
  const lc = stateName.toLowerCase();
  const entry = entries.find((e) => e.n.toLowerCase() === lc);
  return entry ? { name: entry.n, lat: entry.la, lng: entry.lo } : null;
}

/**
 * Search article text for a matching admin-1 subdivision.
 *
 * Strategy (in priority order):
 *  1. Direct text match — scan title, summary, locality for a state/province name
 *  2. City→state lookup — if a known city name appears in the text, resolve it
 *     to the state it belongs to (e.g. "Jos" → Plateau, "Maiduguri" → Borno)
 *  3. Locality field → state lookup — if the story's locality is a known city,
 *     resolve it even if it wasn't found in the text search
 *
 * @param {string} iso — country ISO-A2
 * @param {object} story — { title, summary, locality, region, coordinates, geocodePrecision }
 * @returns {{ name: string, lat: number, lng: number } | null}
 */
export function findStateInStory(iso, story) {
  if (!iso || !story) return null;
  const key = iso.toUpperCase();

  const entries = admin1Data[key];
  if (!entries) return null;

  // Build search text from story fields
  const text = [story.title, story.summary, story.locality]
    .filter(Boolean)
    .join(' ');

  if (!text) return null;
  const textLower = text.toLowerCase();

  // 1. Direct state/province name match — longest first to avoid partial matches
  const sorted = [...entries].sort((a, b) => b.n.length - a.n.length);
  for (const e of sorted) {
    const name = e.n.toLowerCase();
    if (name.length < 3) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
    if (pattern.test(textLower)) {
      return { name: e.n, lat: e.la, lng: e.lo };
    }
  }

  // 2. City→state lookup — extract words/phrases from text and check if any
  //    are known cities that map to a state in this country
  const countryMap = cityToState[key];
  if (countryMap) {
    // Check multi-word city names first (longest keys first)
    const cityNames = Object.keys(countryMap).sort((a, b) => b.length - a.length);
    for (const city of cityNames) {
      if (city.length < 3) continue;
      const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
      if (pattern.test(textLower)) {
        const stateName = countryMap[city];
        const stateEntry = findStateEntry(key, stateName);
        if (stateEntry) return stateEntry;
      }
    }
  }

  // 3. Locality field as city name — the story's locality might be a city
  //    that the text search missed (e.g. if locality was set by a different pipeline)
  if (story.locality) {
    const stateName = cityToStateName(key, story.locality);
    if (stateName) {
      const stateEntry = findStateEntry(key, stateName);
      if (stateEntry) return stateEntry;
    }
  }

  return null;
}
