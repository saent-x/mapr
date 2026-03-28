import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe2 } from 'lucide-react';

/**
 * Full-screen loading overlay displayed during the initial data fetch.
 * Shows skeleton cards and a spinner while the backend briefing is being loaded.
 * Disappears once data is available.
 */
export default function DataLoadingOverlay() {
  const { t } = useTranslation();

  return (
    <div className="data-loading-overlay" role="status" aria-live="polite">
      <div className="data-loading-overlay-inner">
        <Globe2 size={36} className="data-loading-overlay-icon" />
        <span className="data-loading-overlay-text">{t('loading.initialData')}</span>
        <div className="data-loading-overlay-skeletons">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      </div>
    </div>
  );
}
