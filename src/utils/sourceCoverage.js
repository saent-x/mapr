import { ALL_RSS_FEEDS } from '../services/rssService.js';
import { countryToIso, KNOWN_COUNTRY_NAMES } from './geocoder.js';

export const REGION_PRIORITY_GLOBAL_FEED_IDS = [
  'un-news',
  'who-don',
  'usgs-significant',
  'bbc',
  'reuters',
  'aljazeera',
  'guardian-uk',
  'dw',
  'france24'
];

const STATUS_PRIORITY = {
  'ingestion-risk': 0,
  'source-sparse': 1,
  uncovered: 2,
  'low-confidence': 3,
  developing: 4,
  verified: 5
};

function sortCoverageEntries(left, right) {
  return (
    (STATUS_PRIORITY[left.status || 'uncovered'] ?? 99) - (STATUS_PRIORITY[right.status || 'uncovered'] ?? 99)
    || left.localFeedCount - right.localFeedCount
    || left.region.localeCompare(right.region)
  );
}

function uniqueFeeds(feeds) {
  const seen = new Set();

  return feeds.filter((feed) => {
    if (!feed?.id || seen.has(feed.id)) {
      return false;
    }

    seen.add(feed.id);
    return true;
  });
}

export function getFeedCoverageCountries(feed) {
  const coverageCountries = Array.isArray(feed?.coverageCountries)
    ? feed.coverageCountries.filter(Boolean)
    : [];
  const countries = feed?.country ? [feed.country, ...coverageCountries] : coverageCountries;

  return [...new Set(countries)];
}

export function getFeedCoverageIsos(feed) {
  return getFeedCoverageCountries(feed)
    .map((country) => countryToIso(country))
    .filter(Boolean);
}

export function feedTargetsRegion(feed, regionName) {
  if (!feed || !regionName) {
    return false;
  }

  return getFeedCoverageCountries(feed).includes(regionName);
}

export function buildRegionSourcePlan(regionName, {
  limit = 12,
  coverageDiagnostics = null
} = {}) {
  const iso = countryToIso(regionName);
  const localFeeds = ALL_RSS_FEEDS.filter((feed) => feed.country === regionName);
  const regionalFeeds = ALL_RSS_FEEDS.filter((feed) => (
    feed.country !== regionName
    && Array.isArray(feed.coverageCountries)
    && feed.coverageCountries.includes(regionName)
  ));
  const officialFeeds = ALL_RSS_FEEDS.filter((feed) => feed.sourceType === 'official');
  const globalFeeds = REGION_PRIORITY_GLOBAL_FEED_IDS
    .map((feedId) => ALL_RSS_FEEDS.find((feed) => feed.id === feedId))
    .filter(Boolean);
  const plannedFeeds = uniqueFeeds([...localFeeds, ...regionalFeeds, ...officialFeeds, ...globalFeeds]).slice(0, limit);
  const status = iso ? coverageDiagnostics?.byIso?.[iso]?.status || 'uncovered' : 'uncovered';

  return {
    iso: iso || null,
    region: regionName,
    status,
    localFeedCount: localFeeds.length,
    regionalFeedCount: regionalFeeds.length,
    targetedFeedCount: localFeeds.length + regionalFeeds.length,
    officialFeedCount: officialFeeds.length,
    globalFeedCount: globalFeeds.length,
    plannedFeedCount: plannedFeeds.length,
    localFeeds: localFeeds.map((feed) => ({
      id: feed.id,
      name: feed.name,
      sourceType: feed.sourceType || null
    })),
    regionalFeeds: regionalFeeds.map((feed) => ({
      id: feed.id,
      name: feed.name,
      sourceType: feed.sourceType || null
    })),
    plannedFeeds: plannedFeeds.map((feed) => ({
      id: feed.id,
      name: feed.name,
      sourceType: feed.sourceType || null,
      country: feed.country || null
    }))
  };
}

export function buildSourceCoverageAudit(coverageDiagnostics) {
  const byIso = {};

  KNOWN_COUNTRY_NAMES.forEach((country) => {
    const iso = countryToIso(country);
    if (!iso) {
      return;
    }

    byIso[iso] = {
      iso,
      region: country,
      status: coverageDiagnostics?.byIso?.[iso]?.status || 'uncovered',
      eventCount: coverageDiagnostics?.byIso?.[iso]?.eventCount || 0,
      localFeedCount: 0,
      regionalFeedCount: 0,
      targetedFeedCount: 0,
      officialFeedCount: 0,
      globalFeedCount: 0
    };
  });

  ALL_RSS_FEEDS.forEach((feed) => {
    if (feed.country) {
      const iso = countryToIso(feed.country);
      if (!iso || !byIso[iso]) {
        return;
      }

      byIso[iso].localFeedCount += 1;
    }

    const coverageCountries = Array.isArray(feed.coverageCountries)
      ? [...new Set(feed.coverageCountries.filter(Boolean))]
      : [];

    if (coverageCountries.length > 0) {
      coverageCountries.forEach((country) => {
        const iso = countryToIso(country);
        if (!iso || !byIso[iso] || feed.country === country) {
          return;
        }

        byIso[iso].regionalFeedCount += 1;
      });
      return;
    }

    if (!feed.country) {
      const bucket = feed.sourceType === 'official' ? 'officialFeedCount' : 'globalFeedCount';
      Object.values(byIso).forEach((entry) => {
        entry[bucket] += 1;
      });
    }
  });

  const entries = Object.values(byIso)
    .map((entry) => {
      const targetedFeedCount = entry.localFeedCount + entry.regionalFeedCount;
      return {
        ...entry,
        targetedFeedCount
      };
    })
    .sort((left, right) => left.region.localeCompare(right.region));
  entries.forEach((entry) => {
    byIso[entry.iso] = entry;
  });
  const noLocalFeedCountries = entries.filter((entry) => entry.localFeedCount === 0);
  const thinLocalFeedCountries = entries.filter((entry) => entry.localFeedCount === 1);
  const expansionTargets = [...entries]
    .filter((entry) => entry.localFeedCount === 0 || entry.targetedFeedCount <= 1)
    .sort((left, right) => (
      sortCoverageEntries(left, right)
      || left.targetedFeedCount - right.targetedFeedCount
    ));

  return {
    byIso,
    noLocalFeedCountries,
    thinLocalFeedCountries,
    expansionTargets,
    stats: {
      countriesWithLocalFeeds: entries.filter((entry) => entry.localFeedCount > 0).length,
      countriesWithRegionalFeeds: entries.filter((entry) => entry.regionalFeedCount > 0).length,
      countriesWithoutLocalFeeds: noLocalFeedCountries.length,
      thinCoverageCountries: thinLocalFeedCountries.length
    }
  };
}
