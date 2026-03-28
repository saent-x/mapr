import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe2 } from 'lucide-react';

/**
 * Loading fallback displayed while lazy-loaded map components (Globe, FlatMap)
 * are being downloaded and initialized.
 */
export default function MapLoadingFallback() {
  const { t } = useTranslation();

  return (
    <div className="map-loading-fallback" role="status" aria-live="polite">
      <div className="map-loading-fallback-inner">
        <Globe2 size={32} className="map-loading-fallback-icon" />
        <span className="map-loading-fallback-text">{t('loading.map')}</span>
      </div>
    </div>
  );
}
