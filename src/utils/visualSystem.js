export const VISUAL_COLORS = {
  accent: 'var(--accent)',
  info: 'var(--cyan)',
  success: 'var(--sev-green)',
  warning: 'var(--sev-amber)',
  danger: 'var(--sev-red)',
  elevated: 'var(--elevated)',
  muted: 'var(--ink-2)',
  quiet: 'var(--ink-3)',
};

const tone = (name, percent = 14, base = 'var(--bg-0)') =>
  `color-mix(in srgb, var(--${name}) ${percent}%, ${base})`;

const mapPalette = {
  info: '#2d8a94',
  success: '#2e7d55',
  warning: '#c4821e',
  elevated: '#c05828',
  danger: '#c94033',
  muted: '#90939a',
  quiet: '#6b6e76',
  purple: '#7b5aa6',
};

export function getSeverityVisual(severity) {
  if (severity >= 85) {
    return {
      label: 'Critical',
      labelKey: 'critical',
      accent: VISUAL_COLORS.danger,
      muted: tone('sev-red', 16),
      mapFill: 'rgba(201, 64, 51, 0.58)',
      mapSide: 'rgba(201, 64, 51, 0.26)',
      ring: 'rgba(201, 64, 51, 0.78)',
    };
  }

  if (severity >= 60) {
    return {
      label: 'Elevated',
      labelKey: 'elevated',
      accent: VISUAL_COLORS.elevated,
      muted: tone('elevated', 16),
      mapFill: 'rgba(192, 88, 40, 0.54)',
      mapSide: 'rgba(192, 88, 40, 0.24)',
      ring: 'rgba(192, 88, 40, 0.72)',
    };
  }

  if (severity >= 35) {
    return {
      label: 'Watch',
      labelKey: 'watch',
      accent: VISUAL_COLORS.warning,
      muted: tone('sev-amber', 15),
      mapFill: 'rgba(196, 130, 30, 0.48)',
      mapSide: 'rgba(196, 130, 30, 0.22)',
      ring: 'rgba(196, 130, 30, 0.68)',
    };
  }

  return {
    label: 'Low',
    labelKey: 'low',
    accent: VISUAL_COLORS.success,
    muted: tone('sev-green', 13),
    mapFill: 'rgba(46, 125, 85, 0.43)',
    mapSide: 'rgba(46, 125, 85, 0.2)',
    ring: 'rgba(46, 125, 85, 0.62)',
  };
}

const COVERAGE_VISUALS = {
  verified: ['success', 'verified'],
  developing: ['warning', 'developing'],
  'low-confidence': ['elevated', 'lowConfidence'],
  'ingestion-risk': ['danger', 'ingestionRisk'],
  'source-sparse': ['info', 'sourceSparse'],
  uncovered: ['muted', 'uncovered'],
};

export function getCoverageVisual(status = 'uncovered') {
  const [toneName, labelKey] = COVERAGE_VISUALS[status] || COVERAGE_VISUALS.uncovered;
  const token = toneName === 'muted' ? 'ink-2' : toneName === 'info' ? 'cyan' : toneName === 'elevated' ? 'elevated' : toneName === 'danger' ? 'sev-red' : toneName === 'warning' ? 'sev-amber' : 'sev-green';
  const accent = VISUAL_COLORS[toneName] || VISUAL_COLORS.muted;
  const map = mapPalette[toneName] || mapPalette.muted;
  return {
    accent,
    fill: tone(token, toneName === 'muted' ? 8 : 14),
    hoverFill: tone(token, toneName === 'muted' ? 12 : 21),
    selectedFill: tone(token, toneName === 'muted' ? 16 : 28),
    side: tone(token, toneName === 'muted' ? 12 : 24),
    stroke: tone(token, toneName === 'muted' ? 16 : 32),
    mapAccent: map,
    labelKey,
  };
}

const RELIABILITY_VISUALS = {
  high: ['success', 'highReliability'],
  medium: ['warning', 'mediumReliability'],
  low: ['danger', 'lowReliability'],
  unknown: ['muted', 'noReliabilityData'],
};

export function getReliabilityVisual(tier = 'unknown') {
  const [toneName, labelKey] = RELIABILITY_VISUALS[tier] || RELIABILITY_VISUALS.unknown;
  const token = toneName === 'muted' ? 'ink-2' : toneName === 'danger' ? 'sev-red' : toneName === 'warning' ? 'sev-amber' : 'sev-green';
  const accent = VISUAL_COLORS[toneName] || VISUAL_COLORS.muted;
  const map = mapPalette[toneName] || mapPalette.muted;
  return {
    accent,
    fill: tone(token, toneName === 'muted' ? 8 : 14),
    hoverFill: tone(token, toneName === 'muted' ? 12 : 21),
    selectedFill: tone(token, toneName === 'muted' ? 16 : 28),
    stroke: tone(token, toneName === 'muted' ? 16 : 32),
    labelKey,
    dotColor: accent,
    mapAccent: map,
  };
}

export const LIFECYCLE_VISUALS = {
  emerging: VISUAL_COLORS.info,
  developing: VISUAL_COLORS.success,
  escalating: VISUAL_COLORS.danger,
  stabilizing: VISUAL_COLORS.warning,
  resolved: VISUAL_COLORS.muted,
  unknown: VISUAL_COLORS.quiet,
};

export function getAnomalyVisual(type) {
  switch (type) {
    case 'spike':
      return { color: VISUAL_COLORS.danger, label: 'Spike', icon: 'AlertTriangle' };
    case 'elevated':
      return { color: VISUAL_COLORS.elevated, label: 'Elevated', icon: 'TrendingUp' };
    case 'anomalous-silence':
      return { color: 'var(--signal-purple)', label: 'Silence', icon: 'CircleOff' };
    case 'blind-spot':
      return { color: VISUAL_COLORS.muted, label: 'Blind Spot', icon: 'EyeOff' };
    case 'limited-access':
      return { color: VISUAL_COLORS.quiet, label: 'Limited', icon: 'Ban' };
    default:
      return { color: VISUAL_COLORS.muted, label: type, icon: 'Circle' };
  }
}

export function getGeopoliticalLegend() {
  return [
    { key: 'low', color: VISUAL_COLORS.info, mapColor: 'rgba(45, 138, 148, 0.78)', labelKey: 'legend.geoLow' },
    { key: 'medium', color: VISUAL_COLORS.warning, mapColor: 'rgba(196, 130, 30, 0.78)', labelKey: 'legend.geoMedium' },
    { key: 'high', color: VISUAL_COLORS.danger, mapColor: 'rgba(201, 64, 51, 0.78)', labelKey: 'legend.geoHigh' },
  ];
}

