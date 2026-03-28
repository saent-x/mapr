import React from 'react';
import { useTranslation } from 'react-i18next';
import { Loader } from 'lucide-react';

/**
 * Loading fallback for lazy-loaded page routes (Admin, Entities, Trends, etc.).
 */
export default function PageLoadingFallback() {
  const { t } = useTranslation();

  return (
    <div className="page-loading-fallback" role="status" aria-live="polite">
      <Loader size={24} className="page-loading-fallback-icon" />
      <span className="page-loading-fallback-text">{t('loading.page')}</span>
    </div>
  );
}
