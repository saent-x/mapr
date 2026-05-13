// Re-exports for backward compatibility — canonical definitions now live in
// dedicated utility files so this module doesn't grow into a god file.
//
// Note: getMockNews has been removed — the app no longer substitutes
// fabricated data on backend failure. Callers should render an empty list
// plus DataErrorBanner when liveNews is null.

export { calculateRegionSeverity } from './regionSeverity.js';
export { getSeverityMeta } from './severityMeta.js';
export { DATE_WINDOWS, resolveDateFloor } from './dateFloor.js';

export const SORT_OPTIONS = [
  { id: 'severity', label: 'Severity', i18nKey: 'severity' },
  { id: 'latest', label: 'Recent', i18nKey: 'recent' }
];
