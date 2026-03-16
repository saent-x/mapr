const COVERAGE_META = {
  verified: {
    accent: '#4ce39c',
    fill: 'rgba(76, 227, 156, 0.18)',
    hoverFill: 'rgba(76, 227, 156, 0.26)',
    selectedFill: 'rgba(76, 227, 156, 0.34)',
    side: 'rgba(76, 227, 156, 0.34)',
    stroke: 'rgba(76, 227, 156, 0.36)',
    labelKey: 'verified'
  },
  developing: {
    accent: '#ffbe63',
    fill: 'rgba(255, 190, 99, 0.16)',
    hoverFill: 'rgba(255, 190, 99, 0.24)',
    selectedFill: 'rgba(255, 190, 99, 0.32)',
    side: 'rgba(255, 190, 99, 0.32)',
    stroke: 'rgba(255, 190, 99, 0.34)',
    labelKey: 'developing'
  },
  'low-confidence': {
    accent: '#ff7e6b',
    fill: 'rgba(255, 126, 107, 0.15)',
    hoverFill: 'rgba(255, 126, 107, 0.23)',
    selectedFill: 'rgba(255, 126, 107, 0.3)',
    side: 'rgba(255, 126, 107, 0.3)',
    stroke: 'rgba(255, 126, 107, 0.32)',
    labelKey: 'lowConfidence'
  },
  'ingestion-risk': {
    accent: '#ff5f7a',
    fill: 'rgba(255, 95, 122, 0.16)',
    hoverFill: 'rgba(255, 95, 122, 0.24)',
    selectedFill: 'rgba(255, 95, 122, 0.32)',
    side: 'rgba(255, 95, 122, 0.32)',
    stroke: 'rgba(255, 95, 122, 0.35)',
    labelKey: 'ingestionRisk'
  },
  'source-sparse': {
    accent: '#8aa7ff',
    fill: 'rgba(138, 167, 255, 0.1)',
    hoverFill: 'rgba(138, 167, 255, 0.16)',
    selectedFill: 'rgba(138, 167, 255, 0.22)',
    side: 'rgba(138, 167, 255, 0.18)',
    stroke: 'rgba(138, 167, 255, 0.24)',
    labelKey: 'sourceSparse'
  },
  uncovered: {
    accent: 'rgba(255, 255, 255, 0.55)',
    fill: 'rgba(255, 255, 255, 0.02)',
    hoverFill: 'rgba(255, 255, 255, 0.05)',
    selectedFill: 'rgba(255, 255, 255, 0.1)',
    side: 'rgba(255, 255, 255, 0.08)',
    stroke: 'rgba(255, 255, 255, 0.08)',
    labelKey: 'uncovered'
  }
};

export const COVERAGE_STATUS_ORDER = ['verified', 'developing', 'low-confidence', 'ingestion-risk', 'source-sparse', 'uncovered'];

export function getCoverageMeta(status = 'uncovered') {
  return COVERAGE_META[status] || COVERAGE_META.uncovered;
}
