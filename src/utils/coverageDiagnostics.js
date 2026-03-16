import { countryToIso, KNOWN_COUNTRY_NAMES } from './geocoder.js';

const ISO_TO_COUNTRY = KNOWN_COUNTRY_NAMES.reduce((accumulator, countryName) => {
  const iso = countryToIso(countryName);
  if (iso && !accumulator[iso]) {
    accumulator[iso] = countryName;
  }
  return accumulator;
}, {});

function getRegionLabel(iso, coverageEntry, feedEntry) {
  return coverageEntry?.region || feedEntry?.country || ISO_TO_COUNTRY[iso] || iso;
}

function buildFeedHealthByIso(sourceHealth) {
  const feedHealthByIso = new Map();

  (sourceHealth?.rss?.feeds || []).forEach((feed) => {
    const coverageIsos = Array.isArray(feed.coverageIsoA2s) && feed.coverageIsoA2s.length > 0
      ? feed.coverageIsoA2s
      : [feed.isoA2 || countryToIso(feed.country)].filter(Boolean);

    if (coverageIsos.length === 0) {
      return;
    }

    coverageIsos.forEach((iso) => {
      const current = feedHealthByIso.get(iso) || {
        iso,
        country: feed.country || ISO_TO_COUNTRY[iso] || iso,
        feedCount: 0,
        healthyFeeds: 0,
        emptyFeeds: 0,
        failedFeeds: 0
      };

      current.feedCount += 1;
      if (feed.status === 'ok') {
        current.healthyFeeds += 1;
      } else if (feed.status === 'empty') {
        current.emptyFeeds += 1;
      } else if (feed.status === 'failed') {
        current.failedFeeds += 1;
      }

      feedHealthByIso.set(iso, current);
    });
  });

  return feedHealthByIso;
}

function getStatusForCountry(coverageEntry, feedEntry) {
  if (coverageEntry) {
    if (coverageEntry.verifiedCount > 0) {
      return 'verified';
    }

    if (coverageEntry.maxConfidence >= 55) {
      return 'developing';
    }

    return 'low-confidence';
  }

  if (!feedEntry || feedEntry.feedCount === 0) {
    return 'source-sparse';
  }

  if (feedEntry.failedFeeds > 0 && feedEntry.healthyFeeds === 0 && feedEntry.emptyFeeds === 0) {
    return 'ingestion-risk';
  }

  return 'uncovered';
}

function getOrderedEntries(byIso, status) {
  return Object.entries(byIso)
    .filter(([, entry]) => entry.status === status)
    .map(([iso, entry]) => ({ iso, ...entry }))
    .sort((left, right) => {
      if (status === 'ingestion-risk') {
        return (
          right.failedFeeds - left.failedFeeds ||
          right.feedCount - left.feedCount ||
          left.region.localeCompare(right.region)
        );
      }

      if (status === 'low-confidence') {
        return left.maxConfidence - right.maxConfidence || left.region.localeCompare(right.region);
      }

      return left.region.localeCompare(right.region);
    });
}

export function buildCoverageDiagnostics(coverageMetrics, sourceHealth) {
  const byIso = {};
  const feedHealthByIso = buildFeedHealthByIso(sourceHealth);
  const knownIsos = new Set(KNOWN_COUNTRY_NAMES.map(countryToIso).filter(Boolean));

  coverageMetrics?.coverageByIso?.forEach((_, iso) => knownIsos.add(iso));
  feedHealthByIso.forEach((_, iso) => knownIsos.add(iso));

  knownIsos.forEach((iso) => {
    const coverageEntry = coverageMetrics?.coverageByIso?.get(iso) || null;
    const feedEntry = feedHealthByIso.get(iso) || null;
    const status = getStatusForCountry(coverageEntry, feedEntry);

    byIso[iso] = {
      iso,
      region: getRegionLabel(iso, coverageEntry, feedEntry),
      status,
      eventCount: coverageEntry?.eventCount || 0,
      verifiedCount: coverageEntry?.verifiedCount || 0,
      maxConfidence: coverageEntry?.maxConfidence || 0,
      feedCount: feedEntry?.feedCount || 0,
      healthyFeeds: feedEntry?.healthyFeeds || 0,
      emptyFeeds: feedEntry?.emptyFeeds || 0,
      failedFeeds: feedEntry?.failedFeeds || 0
    };
  });

  const lowConfidenceRegions = getOrderedEntries(byIso, 'low-confidence');
  const ingestionRiskRegions = getOrderedEntries(byIso, 'ingestion-risk');
  const sourceSparseRegions = getOrderedEntries(byIso, 'source-sparse');

  return {
    byIso,
    lowConfidenceRegions,
    ingestionRiskRegions,
    sourceSparseRegions,
    diagnosticCounts: {
      lowConfidenceCountries: lowConfidenceRegions.length,
      ingestionRiskCountries: ingestionRiskRegions.length,
      sourceSparseCountries: sourceSparseRegions.length
    }
  };
}
