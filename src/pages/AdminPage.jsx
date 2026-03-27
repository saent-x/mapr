import React from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Construction } from 'lucide-react';

/**
 * Admin dashboard placeholder.
 * Will be expanded with source health monitoring, ingestion status,
 * coverage gaps visualization, and source catalog management.
 */
export default function AdminPage() {
  const { t } = useTranslation();

  return (
    <div className="placeholder-page">
      <div className="placeholder-page-icon">
        <Shield size={48} />
      </div>
      <h1 className="placeholder-page-title">{t('admin.title')}</h1>
      <p className="placeholder-page-desc">{t('admin.placeholder')}</p>
      <div className="placeholder-page-badge">
        <Construction size={14} />
        <span>{t('admin.comingSoon')}</span>
      </div>
    </div>
  );
}
