import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Loading placeholder while the lazy map modules (Globe, FlatMap) are fetched.
 */
export default function MapLoadingFallback() {
  const { t } = useTranslation();
  return (
    <div className="map-loading-fallback" role="status" aria-live="polite">
      {t('loading.map')}
    </div>
  );
}
