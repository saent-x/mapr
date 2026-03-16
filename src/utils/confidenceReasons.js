export const CONFIDENCE_REASON_KEYS = {
  'official-source': 'article.confidenceReason.officialSource',
  'corroborated-sources': 'article.confidenceReason.corroboratedSources',
  'diverse-source-types': 'article.confidenceReason.diverseSourceTypes',
  'cross-border-sources': 'article.confidenceReason.crossBorderSources',
  'locality-precision': 'article.confidenceReason.localityPrecision',
  'country-precision': 'article.confidenceReason.countryPrecision',
  'trusted-sources': 'article.confidenceReason.trustedSources',
  'source-country-fallback': 'article.confidenceReason.sourceCountryFallback',
  'conflicting-location-signals': 'article.confidenceReason.conflictingLocationSignals',
  'summary-derived-location': 'article.confidenceReason.summaryDerivedLocation'
};

export function getConfidenceReasonLabel(t, reason) {
  const key = CONFIDENCE_REASON_KEYS[reason?.type];
  if (!key) {
    return reason?.type || '';
  }

  return t(key, {
    count: reason?.count,
    defaultValue: reason?.type || ''
  });
}
