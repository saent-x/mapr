const PRECISION_SCORES = { locality: 1.0, country: 0.5, 'source-country': 0.2, unknown: 0.1 };

export function computeRegionConfidence({ sourceCount, sourceDiversity, recencyHours, geocodePrecision }) {
  const sourceScore = Math.min(1, (sourceCount || 0) / 10) * 0.3;
  const diversityScore = (sourceDiversity || 0) * 0.25;
  const recencyScore = Math.max(0, 1 - (recencyHours || 0) / 48) * 0.25;
  const precisionScore = (PRECISION_SCORES[geocodePrecision] || 0.1) * 0.2;
  return Math.min(1, Math.max(0, sourceScore + diversityScore + recencyScore + precisionScore));
}
