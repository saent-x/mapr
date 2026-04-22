import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Full-surface loading overlay shown during the initial data fetch.
 * Spinner + shimmering skeleton tiles in the tactical palette.
 */
export default function DataLoadingOverlay() {
  const { t } = useTranslation();

  return (
    <div className="data-loading-overlay" role="status" aria-live="polite">
      <div className="data-loading-overlay-icon" aria-hidden />
      <span>{t('loading.initialData')}</span>
      <div className="data-loading-overlay-skeletons" aria-hidden>
        <div className="data-loading-skeleton skeleton" />
        <div className="data-loading-skeleton skeleton" />
        <div className="data-loading-skeleton skeleton" />
        <div className="data-loading-skeleton skeleton" />
        <div className="data-loading-skeleton skeleton" />
        <div className="data-loading-skeleton skeleton" />
      </div>
    </div>
  );
}
