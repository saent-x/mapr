// Re-exports for backward compatibility — canonical definitions now live in
// dedicated utility files so this module doesn't grow into a god file.

export { getMockNews } from './mockNews.js';
export { calculateRegionSeverity } from './regionSeverity.js';
export { getSeverityMeta } from './severityMeta.js';
export { DATE_WINDOWS, resolveDateFloor } from './dateFloor.js';

export const SORT_OPTIONS = [
  { id: 'severity', label: 'Severity', i18nKey: 'severity' },
  { id: 'latest', label: 'Recent', i18nKey: 'recent' }
];
