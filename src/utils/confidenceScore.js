export function normalizeConfidenceScore(value) {
  if (value == null || typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }

  const percent = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

export function formatConfidencePercent(value) {
  const normalized = normalizeConfidenceScore(value);
  return normalized == null ? '—' : `${normalized}%`;
}
