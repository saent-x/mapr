import { KNOWN_COUNTRY_NAMES } from './geocoder.js';
import { classifySourceType, getSourceNetworkKey, getSourceTrustScore } from './sourceMetadata.js';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'near', 'amid',
  'after', 'before', 'over', 'under', 'across', 'continues', 'continue', 'new',
  'report', 'reports', 'news', 'update', 'updates', 'officials', 'official',
  'says', 'say', 'warn', 'warning', 'warns', 'region', 'state', 'province'
]);

const PRECISION_RANK = {
  locality: 3,
  country: 2,
  'source-country': 1,
  unknown: 0
};

const PRECISION_CONFIDENCE = {
  locality: 0.34,
  country: 0.22,
  'source-country': 0.08,
  unknown: 0.04
};

function normalizeText(value) {
  return (value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function tokenizeHeadline(title) {
  return normalizeText(title)
    .split(' ')
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

export function jaccardSimilarity(leftTokens, rightTokens) {
  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  let intersection = 0;

  left.forEach((token) => {
    if (right.has(token)) {
      intersection += 1;
    }
  });

  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function coordinateDistance(left, right) {
  if (!left?.coordinates || !right?.coordinates) {
    return Number.POSITIVE_INFINITY;
  }

  const latDelta = left.coordinates[0] - right.coordinates[0];
  const lngDelta = left.coordinates[1] - right.coordinates[1];
  return Math.sqrt(latDelta * latDelta + lngDelta * lngDelta);
}

function getEffectivePrecision(article) {
  if (article.geocodePrecision) {
    return article.geocodePrecision;
  }

  if (article.locality && article.region && article.locality !== article.region) {
    return 'locality';
  }

  if (article.region) {
    return 'country';
  }

  return 'unknown';
}

function getPrimaryArticleScore(article, latestPublishedAt) {
  const precision = getEffectivePrecision(article);
  const sourceTrust = getSourceTrustScore(article);
  const hasRealSummary = article.summary && article.summary !== article.title;
  const publishedAt = new Date(article.publishedAt).getTime() || 0;
  const recency = latestPublishedAt > 0 ? publishedAt / latestPublishedAt : 0;

  return (
    (PRECISION_RANK[precision] || 0) * 40 +
    sourceTrust * 24 +
    (hasRealSummary ? 12 : 0) +
    recency * 8 +
    (article.severity || 0) / 10
  );
}

function areArticlesSameEvent(left, right) {
  if (!left || !right) {
    return false;
  }

  if (left.isoA2 !== right.isoA2) {
    return false;
  }

  const leftCategory = left.category || 'General';
  const rightCategory = right.category || 'General';
  const categoriesCompatible = (
    leftCategory === rightCategory ||
    leftCategory === 'General' ||
    rightCategory === 'General'
  );

  if (!categoriesCompatible) {
    return false;
  }

  const leftLocality = normalizeText(left.locality || left.region);
  const rightLocality = normalizeText(right.locality || right.region);
  const sameLocality = leftLocality && leftLocality === rightLocality;
  const closeCoordinates = coordinateDistance(left, right) <= 3.2;
  const similarity = jaccardSimilarity(
    tokenizeHeadline(left.title),
    tokenizeHeadline(right.title)
  );

  if (sameLocality && similarity >= 0.26) {
    return true;
  }

  if (closeCoordinates && similarity >= 0.34) {
    return true;
  }

  return similarity >= 0.72;
}

function hashText(value) {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b1;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 16777619);
    hashB ^= code;
    hashB = Math.imul(hashB, 2246822519);
  }

  return `${(hashA >>> 0).toString(36)}${(hashB >>> 0).toString(36)}`;
}

function buildEventId(primaryArticle, articles) {
  const articleFingerprints = articles
    .map((article) => [
      article.url || '',
      article.id || '',
      article.source || '',
      article.publishedAt || '',
      normalizeText(article.title || '')
    ].join('|'))
    .sort()
    .join('||');

  const seed = [
    primaryArticle.isoA2 || 'XX',
    normalizeText(primaryArticle.locality || primaryArticle.region),
    normalizeText(primaryArticle.title || ''),
    articleFingerprints
  ].join('::');

  return `evt-${hashText(seed)}`;
}

function buildConfidenceContext(articles) {
  const sourceNames = new Set();
  const sourceNetworks = new Set();
  const sourceTypes = new Set();
  const sourceCountries = new Set();
  let maxPrecision = 'unknown';
  let trustTotal = 0;
  let officialSources = 0;
  let conflictingLocationSignals = 0;
  let summaryDerivedSignals = 0;

  articles.forEach((article) => {
    const sourceName = article.source || article.region || article.id;
    const sourceType = classifySourceType(article);
    const sourceNetwork = article.sourceNetwork || getSourceNetworkKey(article);
    const precision = getEffectivePrecision(article);
    const matchedOn = article.geocodeMatchedOn || '';

    sourceNames.add(sourceName);
    sourceNetworks.add(sourceNetwork);
    sourceTypes.add(sourceType);
    if (article.sourceCountry) {
      sourceCountries.add(article.sourceCountry);
    }

    if ((PRECISION_RANK[precision] || 0) > (PRECISION_RANK[maxPrecision] || 0)) {
      maxPrecision = precision;
    }

    if (sourceType === 'official') {
      officialSources += 1;
    }

    if (matchedOn.includes('conflict')) {
      conflictingLocationSignals += 1;
    }

    if (matchedOn.startsWith('summary-')) {
      summaryDerivedSignals += 1;
    }

    trustTotal += getSourceTrustScore(article);
  });

  const sourceCount = sourceNames.size;
  const independentSourceCount = sourceNetworks.size;
  const meanTrust = articles.length ? trustTotal / articles.length : 0.6;
  const corroborationScore = Math.min(0.3, Math.max(0, independentSourceCount - 1) * 0.12);
  const diversityScore = Math.min(0.14, Math.max(0, sourceTypes.size - 1) * 0.05);
  const crossBorderScore = Math.min(0.08, Math.max(0, sourceCountries.size - 1) * 0.04);
  const precisionScore = PRECISION_CONFIDENCE[maxPrecision] || 0.04;
  const officialBoost = officialSources > 0 ? 0.18 : 0;
  const allFallbackPrecision = articles.every((article) => getEffectivePrecision(article) === 'source-country');
  const allSummaryDerived = articles.length > 0 && summaryDerivedSignals === articles.length;
  const fallbackPenalty = allFallbackPrecision
    ? 0.12
    : 0;
  const conflictPenalty = conflictingLocationSignals > 0
    ? 0.08
    : 0;
  const summaryPenalty = allSummaryDerived && !allFallbackPrecision
    ? 0.05
    : 0;

  const rawScore = (
    0.16 +
    precisionScore +
    corroborationScore +
    diversityScore +
    crossBorderScore +
    meanTrust * 0.14 +
    officialBoost -
    fallbackPenalty -
    conflictPenalty -
    summaryPenalty
  );

  return {
    confidence: Math.max(18, Math.min(98, Math.round(rawScore * 100))),
    sourceCount,
    independentSourceCount,
    sourceTypeCount: sourceTypes.size,
    sourceCountryCount: sourceCountries.size,
    maxPrecision,
    meanTrust,
    officialSources,
    allFallbackPrecision,
    conflictingLocationSignals,
    summaryDerivedSignals,
    allSummaryDerived
  };
}

function getConfidenceReasons(context) {
  const reasons = [];

  if (context.officialSources > 0) {
    reasons.push({ type: 'official-source', tone: 'positive', count: context.officialSources });
  }

  if (context.independentSourceCount >= 2) {
    reasons.push({ type: 'corroborated-sources', tone: 'positive', count: context.independentSourceCount });
  }

  if (context.maxPrecision === 'locality') {
    reasons.push({ type: 'locality-precision', tone: 'positive' });
  } else if (context.maxPrecision === 'country') {
    reasons.push({ type: 'country-precision', tone: 'positive' });
  }

  if (context.sourceTypeCount >= 2) {
    reasons.push({ type: 'diverse-source-types', tone: 'positive', count: context.sourceTypeCount });
  }

  if (context.sourceCountryCount >= 2) {
    reasons.push({ type: 'cross-border-sources', tone: 'positive', count: context.sourceCountryCount });
  }

  if (context.meanTrust >= 0.84) {
    reasons.push({ type: 'trusted-sources', tone: 'positive' });
  }

  if (context.allFallbackPrecision) {
    reasons.push({ type: 'source-country-fallback', tone: 'warning' });
  }

  if (context.conflictingLocationSignals > 0) {
    reasons.push({
      type: 'conflicting-location-signals',
      tone: 'warning',
      count: context.conflictingLocationSignals
    });
  }

  if (context.allSummaryDerived) {
    reasons.push({ type: 'summary-derived-location', tone: 'warning' });
  }

  return reasons;
}

function getVerificationStatus(articles, confidence) {
  const sourceNetworks = new Set(articles.map((article) => article.sourceNetwork || getSourceNetworkKey(article)));
  const hasOfficial = articles.some((article) => classifySourceType(article) === 'official');

  if (hasOfficial) {
    return 'official';
  }

  if (sourceNetworks.size >= 2 && confidence >= 70) {
    return 'verified';
  }

  if (sourceNetworks.size >= 2) {
    return 'developing';
  }

  return 'single-source';
}

function buildCanonicalEvent(articles) {
  const latestPublishedAt = Math.max(...articles.map((article) => new Date(article.publishedAt).getTime() || 0), 0);
  const primaryArticle = [...articles].sort(
    (left, right) => getPrimaryArticleScore(right, latestPublishedAt) - getPrimaryArticleScore(left, latestPublishedAt)
  )[0];
  const sourceNames = [...new Set(articles.map((article) => article.source).filter(Boolean))];
  const sourceNetworks = [...new Set(articles.map((article) => article.sourceNetwork || getSourceNetworkKey(article)).filter(Boolean))];
  const sourceTypes = [...new Set(articles.map((article) => classifySourceType(article)))];
  const sourceCountries = [...new Set(articles.map((article) => article.sourceCountry).filter(Boolean))];
  const languages = [...new Set(articles.map((article) => article.language).filter(Boolean))];
  const confidenceContext = buildConfidenceContext(articles);
  const confidence = confidenceContext.confidence;
  const confidenceReasons = getConfidenceReasons(confidenceContext);
  const verificationStatus = getVerificationStatus(articles, confidence);
  const severities = articles.map((article) => article.severity || 0).sort((a, b) => b - a);
  const averageSeverity = severities.reduce((total, severity) => total + severity, 0) / severities.length;
  const severity = Math.round(severities[0] * 0.58 + averageSeverity * 0.42);
  const firstSeenAt = new Date(Math.min(...articles.map((article) => new Date(article.publishedAt).getTime() || Date.now()))).toISOString();
  const lastSeenAt = new Date(Math.max(...articles.map((article) => new Date(article.publishedAt).getTime() || 0))).toISOString();
  const bestPrecision = [...articles]
    .map((article) => getEffectivePrecision(article))
    .sort((left, right) => (PRECISION_RANK[right] || 0) - (PRECISION_RANK[left] || 0))[0] || 'unknown';
  const bestLocationArticle = [...articles].sort((left, right) => (
    (PRECISION_RANK[getEffectivePrecision(right)] || 0) - (PRECISION_RANK[getEffectivePrecision(left)] || 0) ||
    getPrimaryArticleScore(right, latestPublishedAt) - getPrimaryArticleScore(left, latestPublishedAt)
  ))[0];

  // Use the best-located article's geographic data when it has higher precision
  // than the primary article, so events get the most accurate coordinates available.
  const primaryPrecisionRank = PRECISION_RANK[getEffectivePrecision(primaryArticle)] || 0;
  const bestPrecisionRank = PRECISION_RANK[bestPrecision] || 0;
  const useLocationFrom = (bestPrecisionRank > primaryPrecisionRank && bestLocationArticle)
    ? bestLocationArticle : primaryArticle;

  return {
    ...primaryArticle,
    id: buildEventId(primaryArticle, articles),
    title: primaryArticle.title,
    summary: primaryArticle.summary || primaryArticle.title,
    severity,
    averageSeverity,
    publishedAt: lastSeenAt,
    firstSeenAt,
    lastSeenAt,
    source: primaryArticle.source || sourceNames[0] || primaryArticle.region,
    sourceCount: sourceNames.length,
    independentSourceCount: sourceNetworks.length,
    sourceNames,
    sourceNetworks,
    sourceTypes,
    sourceCountries,
    languages,
    articleCount: articles.length,
    confidence,
    confidenceReasons,
    verificationStatus,
    coordinates: useLocationFrom.coordinates,
    region: useLocationFrom.region || primaryArticle.region,
    isoA2: useLocationFrom.isoA2 || primaryArticle.isoA2,
    locality: useLocationFrom.locality || primaryArticle.locality,
    geocodePrecision: bestPrecision,
    geocodeMatchedOn: bestLocationArticle?.geocodeMatchedOn || primaryArticle.geocodeMatchedOn || null,
    supportingArticles: articles
  };
}

export function canonicalizeArticles(articles) {
  const canonicalArticles = [];

  articles.forEach((article) => {
    const normalizedArticle = {
      ...article,
      sourceType: classifySourceType(article),
      sourceNetwork: getSourceNetworkKey(article),
      geocodePrecision: getEffectivePrecision(article)
    };

    const matchingIndex = canonicalArticles.findIndex((eventArticles) => (
      areArticlesSameEvent(eventArticles[0], normalizedArticle)
    ));

    if (matchingIndex >= 0) {
      canonicalArticles[matchingIndex].push(normalizedArticle);
      return;
    }

    canonicalArticles.push([normalizedArticle]);
  });

  return canonicalArticles
    .map((eventArticles) => buildCanonicalEvent(eventArticles))
    .sort((left, right) => (
      right.severity - left.severity ||
      new Date(right.publishedAt) - new Date(left.publishedAt)
    ));
}

export function calculateCoverageMetrics(events) {
  const coverageByIso = new Map();

  events.forEach((event) => {
    if (!event.isoA2 || event.isoA2 === 'XX') {
      return;
    }

    const current = coverageByIso.get(event.isoA2) || {
      eventCount: 0,
      verifiedCount: 0,
      maxConfidence: 0,
      region: event.region
    };

    current.eventCount += 1;
    if (event.verificationStatus === 'verified' || event.verificationStatus === 'official') {
      current.verifiedCount += 1;
    }
    current.maxConfidence = Math.max(current.maxConfidence, event.confidence || 0);
    coverageByIso.set(event.isoA2, current);
  });

  const coveredCountries = coverageByIso.size;
  const verifiedCountries = [...coverageByIso.values()].filter((entry) => entry.verifiedCount > 0).length;
  const lowConfidenceRegions = [...coverageByIso.entries()]
    .filter(([, entry]) => entry.maxConfidence < 55)
    .map(([iso, entry]) => ({ iso, ...entry }))
    .sort((left, right) => left.maxConfidence - right.maxConfidence);

  return {
    totalCountries: KNOWN_COUNTRY_NAMES.length,
    coveredCountries,
    verifiedCountries,
    uncoveredCountries: Math.max(0, KNOWN_COUNTRY_NAMES.length - coveredCountries),
    coverageRate: KNOWN_COUNTRY_NAMES.length ? coveredCountries / KNOWN_COUNTRY_NAMES.length : 0,
    coverageByIso,
    lowConfidenceRegions
  };
}
