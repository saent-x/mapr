/**
 * viewManager.js — saved views and URL encoding utilities
 *
 * URL param mapping:
 *   q           → searchQuery
 *   severity    → minSeverity
 *   confidence  → minConfidence
 *   window      → dateWindow
 *   sort        → sortMode
 *   region      → selectedRegion
 *   mode        → mapMode
 *   overlay     → mapOverlay
 *   entity      → entityFilter
 */

const STORAGE_KEY = 'mapr_saved_views';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId() {
  return `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// createView
// ---------------------------------------------------------------------------

/**
 * Creates a SavedView object.
 * @param {string} name
 * @param {object} filters
 * @param {object} mapState
 * @returns {object}
 */
export function createView(name, filters = {}, mapState = {}) {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    filters: { ...filters },
    mapState: { ...mapState },
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// URL encoding / decoding
// ---------------------------------------------------------------------------

const FILTER_PARAM_MAP = {
  searchQuery:    'q',
  minSeverity:    'severity',
  minConfidence:  'confidence',
  dateWindow:     'window',
  sortMode:       'sort',
  selectedRegion: 'region',
  entityFilter:   'entity',
};

const MAP_STATE_PARAM_MAP = {
  mapMode:    'mode',
  mapOverlay: 'overlay',
};

/** Values that are considered "empty / default" and should be omitted. */
function isDefaultValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (typeof value === 'number' && value === 0) return true;
  return false;
}

/**
 * Encodes a view's filters and mapState into a URL query string.
 * Omits params whose values are empty or default.
 * @param {{ filters?: object, mapState?: object }} view
 * @returns {string}  Query string without leading '?'
 */
export function encodeViewToURL({ filters = {}, mapState = {} } = {}) {
  const params = new URLSearchParams();

  for (const [filterKey, paramKey] of Object.entries(FILTER_PARAM_MAP)) {
    const value = filters[filterKey];
    if (!isDefaultValue(value)) {
      params.set(paramKey, String(value));
    }
  }

  for (const [stateKey, paramKey] of Object.entries(MAP_STATE_PARAM_MAP)) {
    const value = mapState[stateKey];
    if (!isDefaultValue(value)) {
      params.set(paramKey, String(value));
    }
  }

  return params.toString();
}

/**
 * Parses a URLSearchParams instance back into { filters, mapState }.
 * Numeric filter fields are coerced to numbers.
 * @param {URLSearchParams} searchParams
 * @returns {{ filters: object, mapState: object }}
 */
export function decodeURLToFilters(searchParams) {
  const filters = {};
  const mapState = {};

  const numericFilters = new Set(['minSeverity', 'minConfidence']);

  const reverseFilterMap = Object.fromEntries(
    Object.entries(FILTER_PARAM_MAP).map(([k, v]) => [v, k])
  );
  const reverseMapStateMap = Object.fromEntries(
    Object.entries(MAP_STATE_PARAM_MAP).map(([k, v]) => [v, k])
  );

  for (const [paramKey, rawValue] of searchParams.entries()) {
    if (reverseFilterMap[paramKey] !== undefined) {
      const filterKey = reverseFilterMap[paramKey];
      filters[filterKey] = numericFilters.has(filterKey)
        ? Number(rawValue)
        : rawValue;
    } else if (reverseMapStateMap[paramKey] !== undefined) {
      const stateKey = reverseMapStateMap[paramKey];
      mapState[stateKey] = rawValue;
    }
  }

  return { filters, mapState };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serializes an array of views to a JSON string.
 * @param {object[]} views
 * @returns {string}
 */
export function serializeViews(views) {
  return JSON.stringify(views);
}

/**
 * Deserializes a JSON string back to an array of views.
 * Returns [] on null, empty, or invalid input.
 * @param {string|null} json
 * @returns {object[]}
 */
export function deserializeViews(json) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// localStorage persistence (guarded for SSR)
// ---------------------------------------------------------------------------

/**
 * Loads saved views from localStorage.
 * @returns {object[]}
 */
export function loadViews() {
  if (typeof localStorage === 'undefined') return [];
  try {
    return deserializeViews(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/**
 * Persists views array to localStorage.
 * @param {object[]} views
 */
export function saveViews(views) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, serializeViews(views));
  } catch {
    // Quota exceeded or private browsing — silently ignore
  }
}
