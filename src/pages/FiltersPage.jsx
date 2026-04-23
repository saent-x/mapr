import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import FilterDrawer from '../components/FilterDrawer';
import useDerivedIntel from '../hooks/useDerivedIntel';
import useUIStore from '../stores/uiStore';

export default function FiltersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    canonicalNews,
    activeNews,
    sourceCoverageAudit,
    coverageMetrics,
    coverageDiagnostics,
    coverageTrends,
    coverageHistory,
    opsHealth,
    sourceHealth,
  } = useDerivedIntel();

  const selectRegion = useUIStore((s) => s.selectRegion);
  const setLastRegionIso = useUIStore((s) => s.setLastRegionIso);

  const handleRegionSelect = useCallback((iso) => {
    selectRegion(iso);
    if (iso) setLastRegionIso(iso);
    navigate('/');
  }, [selectRegion, setLastRegionIso, navigate]);

  return (
    <div className="mobile-tab-page">
      <header className="mobile-tab-header">
        <button
          type="button"
          className="mobile-tab-back"
          onClick={() => navigate('/')}
          aria-label={t('panel.closePanel')}
        >
          <ChevronLeft size={18} aria-hidden />
        </button>
        <span className="mobile-tab-title">{t('filters.label')}</span>
      </header>
      <div className="mobile-tab-body">
        <FilterDrawer
          variant="inline"
          isOpen
          allNews={canonicalNews}
          filteredNews={activeNews}
          sourceCoverageAudit={sourceCoverageAudit}
          coverageMetrics={coverageMetrics}
          coverageDiagnostics={coverageDiagnostics}
          coverageTrends={coverageTrends}
          coverageHistory={coverageHistory}
          opsHealth={opsHealth}
          sourceHealth={sourceHealth}
          onRegionSelect={handleRegionSelect}
        />
      </div>
    </div>
  );
}
