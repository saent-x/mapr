import { getCoverageVisual } from './visualSystem.js';

export const COVERAGE_STATUS_ORDER = ['verified', 'developing', 'low-confidence', 'ingestion-risk', 'source-sparse', 'uncovered'];

export function getCoverageMeta(status = 'uncovered') {
  return getCoverageVisual(status);
}
