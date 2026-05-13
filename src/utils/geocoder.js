// Built-in city/region database for client-side geocoding.
// Static data moved to geocoder-data.js; logic remains here.
// No external API needed — runs entirely in the browser.

import {
  LOCATIONS,
  COUNTRY_CENTROIDS,
  SOURCE_COUNTRY_MAP,
  COUNTRY_ALIASES,
  LOCATION_ALIASES,
  DEMONYMS,
  COUNTRY_TO_ISO,
  COUNTRY_ADJACENCY,
} from './geocoder-data.js';

function normalizeGeoText(value) {
  return (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createSortedSearchEntries(entries) {
  return entries
    .filter((entry) => entry.key)
    .sort((a, b) => b.key.length - a.key.length);
}

const LOCATION_SEARCH_ENTRIES = createSortedSearchEntries(
  LOCATIONS.flatMap((location) => {
    const aliases = LOCATION_ALIASES[location.name] || [];
    return [location.name, ...aliases].map((alias) => ({
      key: normalizeGeoText(alias),
      location
    }));
  })
);

const COUNTRY_SEARCH_ENTRIES = createSortedSearchEntries([
  ...Object.keys(COUNTRY_CENTROIDS).map((country) => ({
    key: normalizeGeoText(country),
    country
  })),
  ...Object.entries(COUNTRY_ALIASES).flatMap(([country, aliases]) => (
    aliases.map((alias) => ({
      key: normalizeGeoText(alias),
      country
    }))
  ))
]);

const COUNTRY_LOOKUP = new Map(
  COUNTRY_SEARCH_ENTRIES.map((entry) => [entry.key, entry.country])
);

export function getCountryGeoHints(countryName, {
  maxAliases = 4,
  maxLocalities = 4
} = {}) {
  const normalizedCountry = normalizeGeoText(countryName);
  const canonicalCountry = COUNTRY_LOOKUP.get(normalizedCountry) || countryName;
  const aliases = [...new Set((COUNTRY_ALIASES[canonicalCountry] || []).filter(Boolean))].slice(0, maxAliases);
  const localities = [...new Set(
    LOCATIONS
      .filter((location) => location.country === canonicalCountry)
      .map((location) => location.name)
      .filter(Boolean)
  )].slice(0, maxLocalities);

  return {
    country: canonicalCountry || null,
    aliases,
    localities
  };
}

// Demonyms / adjective forms → country name
// Allows matching "Indonesian economy" → Indonesia, "Iranian missile" → Iran, etc.

const SORTED_DEMONYMS = createSortedSearchEntries(
  Object.entries(DEMONYMS).map(([demonym, country]) => ({
    key: normalizeGeoText(demonym),
    country
  }))
);

/**
 * Check if a name match is a whole-word boundary match.
 * Prevents "Niger" from matching inside "Nigeria".
 */
function isWordBoundary(text, idx, matchLen) {
  const before = idx > 0 ? text[idx - 1] : ' ';
  const after = idx + matchLen < text.length ? text[idx + matchLen] : ' ';
  const wordChar = /[a-z0-9]/i;
  return !wordChar.test(before) && !wordChar.test(after);
}

/**
 * Try to find a country in text via country names + demonyms.
 * Returns country name or null.
 */
function findCountryInText(text) {
  for (const entry of COUNTRY_SEARCH_ENTRIES) {
    const idx = text.indexOf(entry.key);
    if (idx !== -1 && isWordBoundary(text, idx, entry.key.length)) {
      return entry.country;
    }
  }

  for (const entry of SORTED_DEMONYMS) {
    const idx = text.indexOf(entry.key);
    if (idx !== -1 && isWordBoundary(text, idx, entry.key.length)) {
      return entry.country;
    }
  }

  return null;
}

/**
 * Try to find a city/region in text.
 * Returns the best (longest) LOCATIONS match or null.
 */
function findCityInText(text) {
  let bestMatch = null;
  let bestLen = 0;

  for (const entry of LOCATION_SEARCH_ENTRIES) {
    const idx = text.indexOf(entry.key);
    if (idx !== -1 && isWordBoundary(text, idx, entry.key.length)) {
      if (entry.key.length > bestLen) {
        bestMatch = entry.location;
        bestLen = entry.key.length;
      }
    }
  }

  return bestMatch;
}

function buildLocalityResult(location, matchedOn) {
  return {
    lat: location.lat,
    lng: location.lng,
    locality: location.name,
    region: location.country,
    precision: 'locality',
    matchedOn
  };
}

function buildCountryResult(country, matchedOn) {
  const centroid = COUNTRY_CENTROIDS[country];
  if (!centroid) {
    return null;
  }

  return {
    lat: centroid[0],
    lng: centroid[1],
    locality: country,
    region: country,
    precision: 'country',
    matchedOn
  };
}

function resolveCountryName(value) {
  const normalized = normalizeGeoText(value);
  return COUNTRY_LOOKUP.get(normalized) || SOURCE_COUNTRY_MAP[value] || value;
}

/**
 * Attempt to geocode an article from its title, summary, and source country.
 * Scans title first (highest signal), then summary, then falls back to source country.
 * Returns { lat, lng, locality, region } or null.
 */
export function geocodeArticle(title, sourcecountry, summary) {
  const titleLower = normalizeGeoText(title);
  const summaryLower = normalizeGeoText(summary).slice(0, 300);

  const titleCity = findCityInText(titleLower);
  const titleCountry = findCountryInText(titleLower);
  const summaryCity = findCityInText(summaryLower);
  const summaryCountry = findCountryInText(summaryLower);

  if (titleCity && (!titleCountry || titleCountry === titleCity.country)) {
    if (!titleCountry) {
      if (summaryCity && summaryCity.country !== titleCity.country) {
        return buildLocalityResult(summaryCity, 'summary-country-conflict');
      }

      if (summaryCountry && summaryCountry !== titleCity.country) {
        const summaryCountryConflictResult = buildCountryResult(summaryCountry, 'summary-country-conflict');
        if (summaryCountryConflictResult) {
          return summaryCountryConflictResult;
        }
      }
    }

    return buildLocalityResult(titleCity, 'title-city');
  }

  if (titleCountry) {
    if (summaryCity && summaryCity.country === titleCountry) {
      return buildLocalityResult(summaryCity, 'summary-city-confirmed');
    }

    const titleCountryResult = buildCountryResult(
      titleCountry,
      titleCity && titleCity.country !== titleCountry ? 'title-country-conflict' : 'title-country'
    );
    if (titleCountryResult) {
      return titleCountryResult;
    }
  }

  if (titleCity) {
    return buildLocalityResult(titleCity, 'title-city');
  }

  if (summaryCity && (!summaryCountry || summaryCountry === summaryCity.country)) {
    return buildLocalityResult(summaryCity, 'summary-city');
  }

  if (summaryCountry) {
    const summaryCountryResult = buildCountryResult(
      summaryCountry,
      summaryCity && summaryCity.country !== summaryCountry ? 'summary-country-conflict' : 'summary-country'
    );
    if (summaryCountryResult) {
      return summaryCountryResult;
    }
  }

  if (summaryCity) {
    return buildLocalityResult(summaryCity, 'summary-city');
  }

  const countryName = resolveCountryName(sourcecountry);
  const coords = COUNTRY_CENTROIDS[countryName];
  if (coords) {
    return {
      lat: coords[0],
      lng: coords[1],
      locality: countryName,
      region: countryName,
      precision: 'source-country',
      matchedOn: 'source-country'
    };
  }

  return null;
}

/**
 * Find ALL countries mentioned in text (not just the first).
 */
function findAllCountriesInText(text) {
  const found = [];
  const seen = new Set();
  for (const entry of COUNTRY_SEARCH_ENTRIES) {
    const idx = text.indexOf(entry.key);
    if (idx !== -1 && isWordBoundary(text, idx, entry.key.length) && !seen.has(entry.country)) {
      seen.add(entry.country);
      found.push(entry.country);
    }
  }
  for (const entry of SORTED_DEMONYMS) {
    const idx = text.indexOf(entry.key);
    if (idx !== -1 && isWordBoundary(text, idx, entry.key.length) && !seen.has(entry.country)) {
      seen.add(entry.country);
      found.push(entry.country);
    }
  }
  return found;
}

/**
 * Find ALL cities mentioned in text, one per country (not just the best match).
 */
function findAllCitiesInText(text) {
  const found = [];
  const seen = new Set();
  for (const entry of LOCATION_SEARCH_ENTRIES) {
    const idx = text.indexOf(entry.key);
    if (idx !== -1 && isWordBoundary(text, idx, entry.key.length) && !seen.has(entry.location.country)) {
      seen.add(entry.location.country);
      found.push(entry.location);
    }
  }
  return found;
}

/**
 * Geocode an article to ALL mentioned countries/cities.
 * Returns an array of geo results (one per country).
 * Excludes the source country so articles appear where they're ABOUT, not where they're FROM.
 */
export function geocodeArticleAll(title, sourcecountry, summary) {
  const titleLower = normalizeGeoText(title);
  const summaryLower = normalizeGeoText(summary).slice(0, 300);
  const combinedText = `${titleLower} ${summaryLower}`;

  const cities = findAllCitiesInText(combinedText);
  const countries = findAllCountriesInText(combinedText);

  const results = [];
  const seenCountries = new Set();

  // Prefer city-level precision where available
  for (const city of cities) {
    if (!seenCountries.has(city.country)) {
      seenCountries.add(city.country);
      results.push(buildLocalityResult(city, 'title-city'));
    }
  }

  for (const country of countries) {
    if (!seenCountries.has(country)) {
      seenCountries.add(country);
      const r = buildCountryResult(country, 'title-country');
      if (r) results.push(r);
    }
  }

  // Exclude source country — article should appear where it's ABOUT, not where it's FROM
  const sourceResolved = resolveCountryName(sourcecountry);
  const filtered = results.filter((r) => r.region !== sourceResolved);

  // If filtering removed everything, keep original results (article IS about its source country)
  if (filtered.length > 0) return filtered;
  if (results.length > 0) return results;

  // Final fallback to single geocodeArticle
  const single = geocodeArticle(title, sourcecountry, summary);
  return single ? [single] : [];
}

/**
 * Get ISO A2 code for a country name (best-effort mapping).
 */

const ISO_TO_COUNTRY = Object.entries(COUNTRY_TO_ISO).reduce((accumulator, [countryName, iso]) => {
  if (!accumulator[iso]) {
    accumulator[iso] = countryName;
  }
  return accumulator;
}, {});

export function countryToIso(countryName) {
  if (!countryName) return null;
  // Direct lookup first
  const direct = COUNTRY_TO_ISO[countryName];
  if (direct) return direct;
  // Resolve through aliases (e.g. "Congo-Brazzaville" → "Congo" → "CG")
  const canonical = COUNTRY_LOOKUP.get(normalizeGeoText(countryName));
  return canonical ? (COUNTRY_TO_ISO[canonical] || null) : null;
}

export function isoToCountry(iso) {
  return ISO_TO_COUNTRY[(iso || '').toUpperCase()] || null;
}

export function areCountriesAdjacent(iso1, iso2) {
  return (COUNTRY_ADJACENCY[iso1] || []).includes(iso2) ||
         (COUNTRY_ADJACENCY[iso2] || []).includes(iso1);
}

export const KNOWN_COUNTRY_NAMES = Object.keys(COUNTRY_TO_ISO).sort();

/**
 * Return all known cities/localities for a given ISO-A2 country code.
 * @param {string} iso — e.g. "NG" for Nigeria
 * @returns {Array<{ name: string, lat: number, lng: number }>}
 */
export function getCitiesByIso(iso) {
  if (!iso) return [];
  const countryName = ISO_TO_COUNTRY[iso.toUpperCase()];
  if (!countryName) return [];
  return LOCATIONS
    .filter((loc) => loc.country === countryName)
    .map(({ name, lat, lng }) => ({ name, lat, lng }));
}
