import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Error banner displayed when the backend is unreachable or returns errors.
 * Shows a user-friendly message with a retry button.
 * The app remains interactive underneath (map renders with fallback/mock data).
 */
export default function DataErrorBanner({ onRetry }) {
  const { t } = useTranslation();

  return (
    <div className="data-error-banner" role="alert" aria-live="assertive">
      <div className="data-error-banner-inner">
        <AlertTriangle size={16} className="data-error-banner-icon" />
        <div className="data-error-banner-content">
          <span className="data-error-banner-title">{t('errors.backendUnreachable')}</span>
          <span className="data-error-banner-detail">{t('errors.fallbackActive')}</span>
        </div>
        <button
          className="data-error-banner-retry"
          onClick={onRetry}
          aria-label={t('errors.retryAction')}
        >
          <RefreshCw size={12} />
          <span>{t('errors.retryAction')}</span>
        </button>
      </div>
    </div>
  );
}
