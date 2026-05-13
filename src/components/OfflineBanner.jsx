import React from 'react';
import { useTranslation } from 'react-i18next';
import { WifiOff } from 'lucide-react';
import useOnlineStatus from '../hooks/useOnlineStatus';

/**
 * OfflineBanner — appears at the top of the app when the browser loses connectivity.
 * Shows an offline message and the "Last updated" timestamp from cached IndexedDB data.
 * Dismisses automatically when connectivity is restored.
 */
export default function OfflineBanner() {
  const { t } = useTranslation();
  const { isOffline, lastUpdatedAge } = useOnlineStatus();

  if (!isOffline) return null;

  return (
    <div className="offline-banner" role="alert" aria-live="assertive">
      <WifiOff size={16} className="offline-banner-icon" aria-hidden="true" />
      <span className="offline-banner-text">
        {t('offline.title', 'Offline')}
        {lastUpdatedAge && (
          <span className="offline-banner-timestamp">
            {' · '}{t('offline.lastUpdated', 'Last updated')}: {lastUpdatedAge}
          </span>
        )}
      </span>
    </div>
  );
}
