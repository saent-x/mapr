import React from 'react';
import { useTranslation } from 'react-i18next';
import { Network, Construction } from 'lucide-react';

/**
 * Entity explorer placeholder.
 * Will be expanded with interactive entity relationship visualization
 * showing connections between people, organizations, locations, and events.
 */
export default function EntityExplorerPage() {
  const { t } = useTranslation();

  return (
    <div className="placeholder-page">
      <div className="placeholder-page-icon">
        <Network size={48} />
      </div>
      <h1 className="placeholder-page-title">{t('entities.title')}</h1>
      <p className="placeholder-page-desc">{t('entities.placeholder')}</p>
      <div className="placeholder-page-badge">
        <Construction size={14} />
        <span>{t('entities.comingSoon')}</span>
      </div>
    </div>
  );
}
