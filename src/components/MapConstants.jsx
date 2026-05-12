/* ──────────────────────────── shared map overlay constants ──────────────────────────── */

export const ARC_COLORS = {
  'same-event': '#f4f1e8',
  'shared-actor': '#2d8a94',
  // Renamed from 'causal-flow' to be honest: these arcs are a category
  // co-occurrence heuristic, NOT a causal claim. The label reads
  // "POSSIBLE SPILLOVER" in the legend.
  'category-cooccurrence': '#c4821e',
};

// HEURISTIC PAIRS — adjacent-country arcs drawn when both events match
// these category patterns. Labels are *suggestive*, not claims.
// The legend explicitly tags these as a heuristic in
// `src/utils/visualSystem.js`. Do not present these as causation.
export const CATEGORY_COOCCURRENCE_PAIRS = [
  { source: 'disaster', target: 'humanitarian', label: 'possible displacement' },
  { source: 'conflict', target: 'humanitarian', label: 'possible refugee flow' },
  { source: 'conflict', target: 'political', label: 'possible diplomatic activity' },
  { source: 'economic', target: 'political', label: 'possible economic pressure' },
  { source: 'political', target: 'conflict', label: 'possible escalation' },
];
// Legacy alias kept so existing imports keep working until consumers migrate.
export const CAUSAL_PAIRS = CATEGORY_COOCCURRENCE_PAIRS;

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
  [85, '#c94033'],
  [60, '#c05828'],
  [35, '#c4821e'],
  [0, '#2e7d55'],
];

export const severityToColor = (sev) => {
  for (const [threshold, color] of SEVERITY_COLORS) {
    if (sev >= threshold) return color;
  }
  return '#2e7d55';
};
