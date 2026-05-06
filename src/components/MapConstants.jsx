/* ──────────────────────────── shared map overlay constants ──────────────────────────── */

export const ARC_COLORS = {
  'same-event': '#ffffff',
  'shared-actor': '#00d4ff',
  'causal-flow': '#ffaa00',
};

export const CAUSAL_PAIRS = [
  { source: 'disaster', target: 'humanitarian', label: 'displacement' },
  { source: 'conflict', target: 'humanitarian', label: 'refugee flow' },
  { source: 'conflict', target: 'political', label: 'diplomatic response' },
  { source: 'economic', target: 'political', label: 'economic pressure' },
  { source: 'political', target: 'conflict', label: 'escalation' },
];

export const normalizeCausalCategory = (cat) => {
  if (!cat) return null;
  const c = cat.toLowerCase();
  if (c.includes('seismic') || c.includes('weather') || c.includes('natural')) return 'disaster';
  if (c.includes('civil') || c.includes('politic')) return 'political';
  if (c.includes('conflict') || c.includes('war') || c.includes('military')) return 'conflict';
  if (c.includes('humanit') || c.includes('refugee') || c.includes('aid')) return 'humanitarian';
  if (c.includes('econom') || c.includes('trade') || c.includes('finance')) return 'economic';
  return c;
};

export const getIso = (f) => {
  const iso = f?.properties?.ISO_A2;
  if (iso && iso !== '-99') return iso;
  return f?.properties?.WB_A2 || f?.properties?.ADM0_A3_US || null;
};

const SEVERITY_COLORS = [
  [85, '#ff3b5c'],
  [60, '#ff8a3d'],
  [35, '#ffc93e'],
  [0, '#3ee8b0'],
];

export const severityToColor = (sev) => {
  for (const [threshold, color] of SEVERITY_COLORS) {
    if (sev >= threshold) return color;
  }
  return '#3ee8b0';
};
