import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Banner rendered when the backend is unreachable. Keeps the underlying app
 * interactive on mock/cached data and exposes a retry action.
 */
export default function DataErrorBanner({ onRetry }) {
  const { t } = useTranslation();
  return (
    <div className="data-error-banner" role="alert" aria-live="assertive">
      <AlertTriangle size={14} color="var(--sev-red)" aria-hidden />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="data-error-banner-title">{t('errors.backendUnreachable')}</span>
        <span style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-0)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {t('errors.fallbackActive')}
        </span>
      </div>
      <button
        type="button"
        className="data-error-banner-retry"
        onClick={onRetry}
        aria-label={t('errors.retryAction')}
      >
        <RefreshCw size={11} aria-hidden />
        {t('errors.retryAction')}
      </button>
    </div>
  );
}
