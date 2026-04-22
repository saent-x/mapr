import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Loading placeholder for lazy-loaded page routes.
 */
export default function PageLoadingFallback() {
  const { t } = useTranslation();
  return (
    <div
      className="page-loading-fallback map-loading-fallback"
      role="status"
      aria-live="polite"
      style={{ background: 'transparent' }}
    >
      {t('loading.page')}
    </div>
  );
}
