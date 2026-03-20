import { buildCoverageDiagnostics } from './coverageDiagnostics.js';
import { calculateCoverageMetrics } from './newsPipeline.js';

function toFiniteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function deriveGdeltStatus(gdelt = {}) {
  const totalProfiles = gdelt.totalProfiles || 0;
  const healthyProfiles = gdelt.healthyProfiles || 0;
  const failedProfiles = gdelt.failedProfiles || 0;
  const normalizedArticles = gdelt.normalizedArticles || gdelt.articleCount || 0;

  if (normalizedArticles > 0 && failedProfiles > 0) {
    return 'degraded';
  }

  if (normalizedArticles > 0) {
    return 'ok';
  }

  if (failedProfiles > 0 || (totalProfiles > 0 && healthyProfiles < totalProfiles)) {
    return 'degraded';
  }

  return totalProfiles > 0 ? 'empty' : 'unknown';
}

function deriveRssStatus(rss = {}) {
  const totalFeeds = rss.totalFeeds || rss.feedCount || 0;
  const healthyFeeds = rss.healthyFeeds || rss.activeFeeds || 0;
  const failedFeeds = rss.failedFeeds || 0;
  const emptyFeeds = rss.emptyFeeds || 0;
  const articlesFound = rss.articlesFound || rss.articleCount || 0;
  const reachableFeeds = healthyFeeds + emptyFeeds;
  const failureRate = totalFeeds > 0 ? failedFeeds / totalFeeds : 0;

  if (reachableFeeds === 0 && failedFeeds > 0) {
    return 'failed';
  }

  if (failedFeeds > 0 && (failureRate >= 0.1 || healthyFeeds === 0)) {
    return 'degraded';
  }

  if (reachableFeeds > 0 || articlesFound > 0) {
    return 'ok';
  }

  return totalFeeds > 0 ? 'empty' : 'unknown';
}

export function deriveBriefingCoverage(briefing = {}) {
  const sourceHealth = briefing.sourceHealth || {};
  const coverageMetrics = calculateCoverageMetrics(briefing.events || []);
  const coverageDiagnostics = buildCoverageDiagnostics(coverageMetrics, sourceHealth);

  return {
    coverageMetrics,
    coverageDiagnostics
  };
}

export function flattenCoverageDiagnostics(coverageMetrics = {}, coverageDiagnostics = {}) {
  const diagnosticCounts = coverageDiagnostics?.diagnosticCounts || coverageDiagnostics || {};

  return {
    coveredCountries: toFiniteNumber(coverageMetrics?.coveredCountries, 0),
    lowConfidenceCountries: toFiniteNumber(diagnosticCounts?.lowConfidenceCountries, 0),
    ingestionRiskCountries: toFiniteNumber(diagnosticCounts?.ingestionRiskCountries, 0),
    sourceSparseCountries: toFiniteNumber(diagnosticCounts?.sourceSparseCountries, 0),
    lowConfidenceRegions: (coverageDiagnostics?.lowConfidenceRegions || []).slice(0, 10),
    ingestionRiskRegions: (coverageDiagnostics?.ingestionRiskRegions || []).slice(0, 10),
    sourceSparseRegions: (coverageDiagnostics?.sourceSparseRegions || []).slice(0, 10)
  };
}

function normalizeCoverageMetrics(coverageMetrics = {}, coverageDiagnostics = {}) {
  const totalCountries = toFiniteNumber(coverageMetrics?.totalCountries, 0);
  const coveredCountries = toFiniteNumber(
    coverageMetrics?.coveredCountries,
    toFiniteNumber(coverageDiagnostics?.coveredCountries, 0)
  );
  const verifiedCountries = toFiniteNumber(coverageMetrics?.verifiedCountries, 0);
  const uncoveredCountries = Number.isFinite(coverageMetrics?.uncoveredCountries)
    ? coverageMetrics.uncoveredCountries
    : Math.max(0, totalCountries - coveredCountries);
  const coverageRate = Number.isFinite(coverageMetrics?.coverageRate)
    ? coverageMetrics.coverageRate
    : (totalCountries > 0 ? coveredCountries / totalCountries : 0);

  return {
    ...coverageMetrics,
    totalCountries,
    coveredCountries,
    verifiedCountries,
    uncoveredCountries,
    coverageRate,
    coverageByIso: coverageMetrics?.coverageByIso || new Map(),
    lowConfidenceRegions: coverageMetrics?.lowConfidenceRegions || []
  };
}

export function normalizeAdminSourceHealth(sourceHealth = {}) {
  const gdelt = sourceHealth.gdelt || {};
  const rss = sourceHealth.rss || {};
  const totalFeeds = rss.totalFeeds || rss.feedCount || 0;
  const healthyFeeds = rss.healthyFeeds || rss.activeFeeds || 0;
  const failedFeeds = rss.failedFeeds || 0;
  const emptyFeeds = rss.emptyFeeds || 0;
  const reachableFeeds = healthyFeeds + emptyFeeds;

  return {
    gdelt: {
      status: deriveGdeltStatus(gdelt),
      totalProfiles: gdelt.totalProfiles || 0,
      healthyProfiles: gdelt.healthyProfiles || 0,
      failedProfiles: gdelt.failedProfiles || 0,
      normalizedArticles: gdelt.normalizedArticles || gdelt.articleCount || 0,
      profiles: gdelt.profiles || []
    },
    rss: {
      status: deriveRssStatus(rss),
      articlesFound: rss.articlesFound || rss.articleCount || 0,
      totalFeeds,
      healthyFeeds,
      reachableFeeds,
      failedFeeds,
      emptyFeeds,
      failureRate: totalFeeds > 0 ? failedFeeds / totalFeeds : 0,
      feeds: rss.feeds || []
    },
    backend: sourceHealth.backend || { status: 'unknown' }
  };
}

export function buildAdminHealthPayload(briefing = {}, { timestamp = new Date().toISOString() } = {}) {
  const { coverageMetrics, coverageDiagnostics } = deriveBriefingCoverage(briefing);
  const sourceHealth = normalizeAdminSourceHealth(briefing.sourceHealth || {});
  const flattenedCoverageDiagnostics = flattenCoverageDiagnostics(coverageMetrics, coverageDiagnostics);

  return {
    timestamp,
    pipeline: {
      source: briefing.meta?.source || 'unknown',
      fetchedAt: briefing.meta?.fetchedAt || null,
      gdeltArticles: sourceHealth.gdelt.normalizedArticles,
      rssArticles: sourceHealth.rss.articlesFound,
      totalArticles: briefing.articles?.length || 0,
      totalEvents: briefing.events?.length || 0,
      totalFeeds: sourceHealth.rss.totalFeeds
    },
    sourceHealth,
    coverageMetrics: normalizeCoverageMetrics(coverageMetrics, flattenedCoverageDiagnostics),
    coverageDiagnostics: flattenedCoverageDiagnostics
  };
}

export function mergeAdminHealthPayloads(primaryPayload = {}, fallbackPayload = {}) {
  const primarySourceHealth = normalizeAdminSourceHealth(primaryPayload?.sourceHealth || {});
  const fallbackSourceHealth = normalizeAdminSourceHealth(fallbackPayload?.sourceHealth || {});
  const primaryCoverageDiagnostics = flattenCoverageDiagnostics(
    primaryPayload?.coverageMetrics,
    primaryPayload?.coverageDiagnostics
  );
  const fallbackCoverageDiagnostics = flattenCoverageDiagnostics(
    fallbackPayload?.coverageMetrics,
    fallbackPayload?.coverageDiagnostics
  );
  const primaryCoverageMetrics = normalizeCoverageMetrics(
    primaryPayload?.coverageMetrics,
    primaryCoverageDiagnostics
  );
  const fallbackCoverageMetrics = normalizeCoverageMetrics(
    fallbackPayload?.coverageMetrics,
    fallbackCoverageDiagnostics
  );
  const pipelineEventCount = toFiniteNumber(primaryPayload?.pipeline?.totalEvents, 0);
  const shouldUseFallbackCoverage = (
    pipelineEventCount > 0 &&
    primaryCoverageMetrics.coveredCountries === 0 &&
    fallbackCoverageMetrics.coveredCountries > 0
  );
  const mergedCoverageMetrics = shouldUseFallbackCoverage ? fallbackCoverageMetrics : primaryCoverageMetrics;
  const mergedCoverageDiagnostics = shouldUseFallbackCoverage
    ? fallbackCoverageDiagnostics
    : primaryCoverageDiagnostics;
  const shouldUseFallbackSourceHealth = (
    primarySourceHealth?.rss?.status === 'unknown' ||
    primarySourceHealth?.gdelt?.status === 'unknown' ||
    (
      primaryPayload?.pipeline?.totalEvents > 0 &&
      primarySourceHealth?.rss?.status === 'ok' &&
      fallbackSourceHealth?.rss?.status === 'degraded'
    )
  );

  return {
    ...primaryPayload,
    sourceHealth: shouldUseFallbackSourceHealth ? fallbackSourceHealth : primarySourceHealth,
    coverageMetrics: mergedCoverageMetrics,
    coverageDiagnostics: mergedCoverageDiagnostics
  };
}
