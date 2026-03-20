import { ALL_RSS_FEEDS } from '../src/services/rssService.js';
import { countryToIso } from '../src/utils/geocoder.js';
import { readSourceCatalogValue, writeSourceCatalogValue } from './sourceCatalogStore.js';
import { getSourceCandidates } from './sourceCandidates.js';

const SOURCE_CATALOG_KEY = 'sourceCatalog';
const SOURCE_STATE_KEY = 'sourceCatalogState';

const CADENCE_BY_CLASS = {
  official: 20,
  wire: 30,
  global: 45,
  regional: 60,
  local: 90,
  default: 75
};

function getCoverageCountries(feed) {
  const coverageCountries = Array.isArray(feed?.coverageCountries)
    ? feed.coverageCountries.filter(Boolean)
    : [];

  return [...new Set(feed?.country ? [feed.country, ...coverageCountries] : coverageCountries)];
}

function inferSourceClass(feed) {
  if (feed?.sourceType === 'official') return 'official';
  if (feed?.sourceType === 'wire') return 'wire';
  if (feed?.sourceType === 'global') return 'global';
  if (feed?.sourceType === 'regional') return 'regional';
  if (feed?.country) return 'local';
  return 'global';
}

function inferPriority(sourceClass) {
  switch (sourceClass) {
    case 'official':
      return 0;
    case 'wire':
      return 1;
    case 'global':
      return 2;
    case 'regional':
      return 3;
    case 'local':
      return 4;
    default:
      return 5;
  }
}

function normalizePriority(priority, sourceClass) {
  if (Number.isFinite(priority)) {
    return priority;
  }

  switch (String(priority || '').toLowerCase()) {
    case 'critical':
      return 0;
    case 'high':
      return 1;
    case 'medium':
      return 3;
    case 'low':
      return 5;
    default:
      return inferPriority(sourceClass);
  }
}

function normalizeCatalogEntry(feed, index = 0) {
  const sourceClass = inferSourceClass(feed);
  const coverageCountries = getCoverageCountries(feed);
  const fetchMode = feed.fetchMode || feed.mode || 'rss';

  return {
    id: feed.id,
    name: feed.name || feed.source,
    url: feed.url || feed.website,
    country: feed.country || null,
    isoA2: feed.country ? countryToIso(feed.country) || null : null,
    sourceType: feed.sourceType || (feed.country ? 'local' : null),
    sourceClass,
    language: feed.language || null,
    coverageCountries,
    coverageIsoA2s: coverageCountries.map((country) => countryToIso(country)).filter(Boolean),
    cadenceMinutes: Number(feed.cadenceMinutes) || CADENCE_BY_CLASS[sourceClass] || CADENCE_BY_CLASS.default,
    priority: normalizePriority(feed.priority, sourceClass),
    fetchMode,
    enabled: feed.enabled ?? (fetchMode === 'rss'),
    candidate: Boolean(feed.candidate || fetchMode !== 'rss'),
    notes: feed.notes || null,
    seedIndex: Number.isFinite(feed.seedIndex) ? feed.seedIndex : index
  };
}

export function getDefaultSourceCatalog() {
  const rssFeeds = ALL_RSS_FEEDS.map((feed, index) => normalizeCatalogEntry(feed, index));
  const candidateFeeds = getSourceCandidates().map((feed, index) => normalizeCatalogEntry(feed, rssFeeds.length + index));
  return [...rssFeeds, ...candidateFeeds];
}

function normalizeSavedCatalog(catalog) {
  return (Array.isArray(catalog) ? catalog : [])
    .map((entry, index) => normalizeCatalogEntry(entry, index))
    .filter((entry) => Boolean(entry.id && entry.name && entry.url));
}

function mergeCatalogWithDefaults(savedCatalog) {
  const defaults = getDefaultSourceCatalog();
  const savedById = new Map(normalizeSavedCatalog(savedCatalog).map((entry) => [entry.id, entry]));
  const merged = defaults.map((entry) => {
    const savedEntry = savedById.get(entry.id) || {};
    const nextEntry = {
      ...entry,
      ...savedEntry
    };

    if (entry.candidate && entry.fetchMode === 'html') {
      nextEntry.enabled = entry.enabled;
      nextEntry.cadenceMinutes = entry.cadenceMinutes;
    }

    return nextEntry;
  });

  savedById.forEach((entry, id) => {
    if (!merged.some((candidate) => candidate.id === id)) {
      merged.push(entry);
    }
  });

  return normalizeSavedCatalog(merged);
}

export async function readSourceCatalog() {
  const savedCatalog = await readSourceCatalogValue(SOURCE_CATALOG_KEY, null);
  if (Array.isArray(savedCatalog) && savedCatalog.length > 0) {
    const mergedCatalog = mergeCatalogWithDefaults(savedCatalog);
    await writeSourceCatalogValue(SOURCE_CATALOG_KEY, mergedCatalog);
    return mergedCatalog;
  }

  const defaultCatalog = getDefaultSourceCatalog();
  await writeSourceCatalogValue(SOURCE_CATALOG_KEY, defaultCatalog);
  return defaultCatalog;
}

export async function writeSourceCatalog(catalog) {
  const normalized = normalizeSavedCatalog(catalog);
  await writeSourceCatalogValue(SOURCE_CATALOG_KEY, normalized);
  return normalized;
}

export async function readSourceState() {
  return await readSourceCatalogValue(SOURCE_STATE_KEY, {});
}

export async function writeSourceState(state) {
  await writeSourceCatalogValue(SOURCE_STATE_KEY, state || {});
  return state || {};
}

export function isRunnableSource(source) {
  return Boolean(source)
    && source.enabled !== false
    && ['rss', 'html'].includes(source.fetchMode || 'rss');
}

function computeNextCheckAt(lastCheckedAt, cadenceMinutes) {
  if (!lastCheckedAt || !cadenceMinutes) {
    return null;
  }

  const nextAt = new Date(new Date(lastCheckedAt).getTime() + cadenceMinutes * 60_000);
  return Number.isNaN(nextAt.getTime()) ? null : nextAt.toISOString();
}

export function hydrateSourceCatalog(catalog, sourceState = {}) {
  return (Array.isArray(catalog) ? catalog : []).map((entry) => {
    const state = sourceState?.[entry.id] || {};
    const lastCheckedAt = state.lastCheckedAt || null;
    const nextCheckAt = state.nextCheckAt || computeNextCheckAt(lastCheckedAt, entry.cadenceMinutes);

    return {
      ...entry,
      lastCheckedAt,
      lastSuccessAt: state.lastSuccessAt || null,
      lastStatus: state.lastStatus || 'never-checked',
      lastError: state.lastError || null,
      lastArticleCount: state.lastArticleCount || 0,
      nextCheckAt
    };
  });
}

export function isSourceDue(source, now = Date.now()) {
  if (!source?.enabled) {
    return false;
  }

  if (!source.lastCheckedAt) {
    return true;
  }

  const lastCheckedMs = new Date(source.lastCheckedAt).getTime();
  if (!Number.isFinite(lastCheckedMs)) {
    return true;
  }

  return (now - lastCheckedMs) >= (source.cadenceMinutes || CADENCE_BY_CLASS.default) * 60_000;
}

export function selectSourcesForRun(catalog, sourceState, {
  force = false,
  feedIds = null,
  limit = null
} = {}) {
  const hydrated = hydrateSourceCatalog(catalog, sourceState);
  const requestedIds = Array.isArray(feedIds) && feedIds.length > 0
    ? new Set(feedIds)
    : null;

  const selected = hydrated
    .filter((entry) => isRunnableSource(entry))
    .filter((entry) => !requestedIds || requestedIds.has(entry.id))
    .filter((entry) => force || requestedIds || isSourceDue(entry))
    .sort((left, right) => {
      if (force || requestedIds) {
        return (left.priority - right.priority) || (left.seedIndex - right.seedIndex);
      }

      const leftDueAt = left.nextCheckAt ? new Date(left.nextCheckAt).getTime() : 0;
      const rightDueAt = right.nextCheckAt ? new Date(right.nextCheckAt).getTime() : 0;
      return (
        leftDueAt - rightDueAt ||
        left.priority - right.priority ||
        left.seedIndex - right.seedIndex
      );
    });

  return Number.isFinite(limit) && limit > 0
    ? selected.slice(0, limit)
    : selected;
}

export function mergeSourceState(catalog, previousState = {}, feedResults = [], checkedAt = new Date().toISOString()) {
  const nextState = { ...(previousState || {}) };
  const feedResultsById = new Map((Array.isArray(feedResults) ? feedResults : []).map((feed) => [feed.feedId, feed]));

  (Array.isArray(catalog) ? catalog : []).forEach((source) => {
    const result = feedResultsById.get(source.id);
    const prior = previousState?.[source.id] || {};

    if (!result) {
      nextState[source.id] = {
        ...prior,
        nextCheckAt: prior.nextCheckAt || computeNextCheckAt(prior.lastCheckedAt, source.cadenceMinutes)
      };
      return;
    }

    const lastCheckedAt = checkedAt;
    const lastSuccessAt = result.status === 'failed'
      ? prior.lastSuccessAt || null
      : checkedAt;

    nextState[source.id] = {
      lastCheckedAt,
      lastSuccessAt,
      lastStatus: result.status,
      lastError: result.error || null,
      lastArticleCount: result.articleCount || 0,
      nextCheckAt: computeNextCheckAt(lastCheckedAt, source.cadenceMinutes)
    };
  });

  return nextState;
}

export function summarizeSourceCatalog(catalog, sourceState = {}) {
  const hydrated = hydrateSourceCatalog(catalog, sourceState);
  const enabled = hydrated.filter((entry) => entry.enabled);
  const runnable = hydrated.filter((entry) => isRunnableSource(entry));
  const due = runnable.filter((entry) => isSourceDue(entry));
  const candidates = hydrated.filter((entry) => entry.candidate || (entry.fetchMode || 'rss') !== 'rss');

  return {
    totalSources: hydrated.length,
    enabledSources: enabled.length,
    runnableSources: runnable.length,
    dueSources: due.length,
    localSources: runnable.filter((entry) => entry.sourceClass === 'local').length,
    regionalSources: runnable.filter((entry) => entry.sourceClass === 'regional').length,
    globalSources: runnable.filter((entry) => entry.sourceClass === 'global' || entry.sourceClass === 'wire').length,
    officialSources: runnable.filter((entry) => entry.sourceClass === 'official').length,
    htmlSources: hydrated.filter((entry) => (entry.fetchMode || 'rss') === 'html').length,
    candidateSources: candidates.length
  };
}
