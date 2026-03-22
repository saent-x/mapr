import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { DATE_WINDOWS, SORT_OPTIONS, getSeverityMeta } from '../utils/mockData';

const VERIFICATION_OPTIONS = ['all', 'official', 'verified', 'developing', 'single-source'];
const SOURCE_TYPE_OPTIONS = ['all', 'official', 'wire', 'global', 'regional', 'local', 'unknown'];
const PRECISION_OPTIONS = ['all', 'locality', 'country', 'source-country', 'unknown'];
const ACCURACY_MODE_OPTIONS = ['standard', 'strict'];
const LANGUAGE_LABELS = {
  en: 'EN',
  es: 'ES',
  fr: 'FR',
  ar: 'AR',
  zh: 'ZH',
  unknown: '??'
};

function getCoverageLabelKey(status) {
  if (status === 'low-confidence') return 'lowConfidence';
  if (status === 'ingestion-risk') return 'ingestionRisk';
  if (status === 'source-sparse') return 'sourceSparse';
  return status || 'uncovered';
}

const FilterDrawer = ({
  isOpen,
  defaultTab = 'filters',
  onClose,
  dateWindow,
  setDateWindow,
  mapOverlay,
  setMapOverlay,
  verificationFilter,
  setVerificationFilter,
  sourceTypeFilter,
  setSourceTypeFilter,
  languageFilter,
  setLanguageFilter,
  accuracyMode,
  setAccuracyMode,
  sourceCoverageAudit,
  precisionFilter,
  setPrecisionFilter,
  minSeverity,
  setMinSeverity,
  minConfidence,
  setMinConfidence,
  sortMode,
  setSortMode,
  coverageMetrics,
  coverageDiagnostics,
  coverageTrends,
  coverageHistory,
  opsHealth,
  allNews = [],
  filteredNews = [],
  sourceHealth,
  onRegionSelect,
  hideAmplified = false,
  setHideAmplified
}) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState(defaultTab);

  // Sync tab when opened from a specific button
  React.useEffect(() => {
    if (isOpen) setTab(defaultTab);
  }, [isOpen, defaultTab]);
  const sevMeta = getSeverityMeta(minSeverity);

  const availableSourceTypes = useMemo(() => (
    SOURCE_TYPE_OPTIONS.filter((type) => (
      type === 'all' || allNews.some((story) => (story.sourceTypes || [story.sourceType]).includes(type))
    ))
  ), [allNews]);

  const availableLanguages = useMemo(() => {
    const languages = new Set();
    allNews.forEach((story) => {
      (story.languages || [story.language]).filter(Boolean).forEach((language) => {
        languages.add(language);
      });
    });
    return ['all', ...[...languages].filter((language) => language !== 'unknown').sort()];
  }, [allNews]);

  const availablePrecisions = useMemo(() => (
    PRECISION_OPTIONS.filter((precision) => (
      precision === 'all' || allNews.some((story) => (story.geocodePrecision || 'unknown') === precision)
    ))
  ), [allNews]);

  const sourceMix = useMemo(() => {
    const summary = { official: 0, wire: 0, global: 0, regional: 0, local: 0, unknown: 0 };
    const languages = new Set();
    filteredNews.forEach((story) => {
      const dominantType = story.sourceTypes?.includes('official')
        ? 'official'
        : story.sourceType || story.sourceTypes?.[0] || 'unknown';
      summary[dominantType] = (summary[dominantType] || 0) + 1;
      (story.languages || [story.language]).filter(Boolean).forEach((language) => {
        if (language !== 'unknown') languages.add(language);
      });
    });
    return { summary, languageCount: languages.size };
  }, [filteredNews]);

  const precisionMix = useMemo(() => {
    const summary = { locality: 0, country: 0, 'source-country': 0, unknown: 0 };
    filteredNews.forEach((story) => {
      const precision = story.geocodePrecision || 'unknown';
      summary[precision] = (summary[precision] || 0) + 1;
    });
    return summary;
  }, [filteredNews]);

  const lowConfidenceRegions = coverageDiagnostics?.lowConfidenceRegions || [];
  const diagnosticCounts = coverageDiagnostics?.diagnosticCounts || {
    lowConfidenceCountries: 0, ingestionRiskCountries: 0, sourceSparseCountries: 0
  };
  const risingRegions = coverageTrends?.risingRegions || [];
  const newlyVerifiedRegions = coverageTrends?.newlyVerifiedRegions || [];
  const atRiskTrendRegions = coverageTrends?.atRiskRegions || [];
  const hasTrendData = risingRegions.length > 0 || newlyVerifiedRegions.length > 0 || atRiskTrendRegions.length > 0;
  const coveragePercent = Math.round((coverageMetrics?.coverageRate || 0) * 100);

  return (
    <div className={`filter-drawer ${isOpen ? 'is-open' : ''}`}>
      {/* Header with tabs + close */}
      <div className="filter-drawer-header">
        <div className="filter-drawer-tabs">
          <button
            className={`filter-drawer-tab ${tab === 'filters' ? 'is-active' : ''}`}
            onClick={() => setTab('filters')}
          >
            FILTERS
          </button>
          <button
            className={`filter-drawer-tab ${tab === 'intel' ? 'is-active' : ''}`}
            onClick={() => setTab('intel')}
          >
            INTEL
          </button>
        </div>
        <button className="filter-drawer-close" onClick={onClose} aria-label="Close">
          <X size={12} />
        </button>
      </div>

      {/* ── FILTERS TAB ── */}
      {tab === 'filters' && (
        <div className="filter-drawer-body">
          <div className="filter-section">
            <div className="filter-label">{t('filters.timeRange')}</div>
            <div className="filter-chips">
              {DATE_WINDOWS.map((opt) => (
                <button key={opt.id} className={`chip ${dateWindow === opt.id ? 'is-active' : ''}`} onClick={() => setDateWindow(opt.id)}>
                  {t(`filters.${opt.i18nKey}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <div className="filter-label">{t('filters.sortBy')}</div>
            <div className="filter-chips">
              {SORT_OPTIONS.map((opt) => (
                <button key={opt.id} className={`chip ${sortMode === opt.id ? 'is-active' : ''}`} onClick={() => setSortMode(opt.id)}>
                  {t(`filters.${opt.i18nKey}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <div className="filter-label">{t('filters.mapOverlay')}</div>
            <div className="filter-chips">
              {['severity', 'coverage'].map((mode) => (
                <button key={mode} className={`chip ${mapOverlay === mode ? 'is-active' : ''}`} onClick={() => setMapOverlay(mode)}>
                  {t(`legend.${mode}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <div className="filter-label">{t('filters.verification')}</div>
            <div className="filter-chips">
              {VERIFICATION_OPTIONS.map((option) => (
                <button key={option} className={`chip ${verificationFilter === option ? 'is-active' : ''}`} onClick={() => setVerificationFilter(option)}>
                  {option === 'all' ? t('filters.all') : t(`article.verificationStatus.${option}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <div className="filter-label">{t('filters.accuracyMode')}</div>
            <div className="filter-chips">
              {ACCURACY_MODE_OPTIONS.map((option) => (
                <button key={option} className={`chip ${accuracyMode === option ? 'is-active' : ''}`} onClick={() => setAccuracyMode(option)}>
                  {t(`filters.${option === 'strict' ? 'strictAccuracy' : 'standard'}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <div className="filter-label">{t('filters.sourceType')}</div>
            <div className="filter-chips">
              {availableSourceTypes.map((option) => (
                <button key={option} className={`chip ${sourceTypeFilter === option ? 'is-active' : ''}`} onClick={() => setSourceTypeFilter(option)}>
                  {option === 'all' ? t('filters.all') : t(`sourceType.${option}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <div className="filter-label">{t('filters.language')}</div>
            <div className="filter-chips">
              {availableLanguages.map((option) => (
                <button key={option} className={`chip ${languageFilter === option ? 'is-active' : ''}`} onClick={() => setLanguageFilter(option)}>
                  {option === 'all' ? t('filters.all') : (LANGUAGE_LABELS[option] || option.toUpperCase())}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <div className="filter-label">{t('filters.locationPrecision')}</div>
            <div className="filter-chips">
              {availablePrecisions.map((option) => (
                <button key={option} className={`chip ${precisionFilter === option ? 'is-active' : ''}`} onClick={() => setPrecisionFilter(option)}>
                  {option === 'all' ? t('filters.all') : t(`precision.${option}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <div className="filter-label">
              {t('filters.minSeverity')}
              <strong style={{ color: sevMeta.accent, marginLeft: 'auto' }}>{minSeverity}</strong>
            </div>
            <input type="range" className="severity-slider-track" min="0" max="100" value={minSeverity} onChange={(e) => setMinSeverity(Number(e.target.value))} />
            <div className="severity-value">
              <span style={{ color: sevMeta.accent }}>{t(`legend.${sevMeta.labelKey}`)}</span>
            </div>
          </div>

          <div className="filter-section">
            <div className="filter-label">
              {t('filters.minConfidence')}
              <strong style={{ marginLeft: 'auto' }}>{minConfidence}%</strong>
            </div>
            <input type="range" className="severity-slider-track" min="0" max="100" step="5" value={minConfidence} onChange={(e) => setMinConfidence(Number(e.target.value))} />
          </div>

          {setHideAmplified && (
            <div className="filter-section">
              <div className="filter-label">Signal quality</div>
              <label className="filter-toggle amplification-toggle">
                <input
                  type="checkbox"
                  checked={hideAmplified}
                  onChange={(e) => setHideAmplified(e.target.checked)}
                />
                <span>Hide amplified events</span>
              </label>
            </div>
          )}
        </div>
      )}

      {/* ── INTEL TAB ── */}
      {tab === 'intel' && (() => {
        const gdeltHealthy = sourceHealth?.gdelt?.healthyProfiles || 0;
        const gdeltTotal = sourceHealth?.gdelt?.totalProfiles || 0;
        const rssHealthy = sourceHealth?.rss?.healthyFeeds || 0;
        const rssTotal = sourceHealth?.rss?.totalFeeds || 0;
        const rssFailed = sourceHealth?.rss?.failedFeeds || 0;
        const totalIngested = (sourceHealth?.gdelt?.normalizedArticles || 0) + (sourceHealth?.rss?.articlesFound || 0);
        const dataStatus = gdeltTotal === 0 && rssTotal === 0
          ? 'offline'
          : (gdeltHealthy === 0 && rssHealthy < rssTotal * 0.5) ? 'degraded' : 'operational';
        const statusColor = dataStatus === 'operational' ? 'var(--low)' : dataStatus === 'degraded' ? 'var(--elevated)' : 'var(--critical)';

        // Feed health trend indicator
        const feedHealthRatio = rssTotal > 0 ? rssHealthy / rssTotal : null;
        const feedTrendIndicator = feedHealthRatio === null
          ? null
          : feedHealthRatio >= 0.8
            ? { symbol: '↑', color: 'var(--low)', label: 'healthy' }
            : feedHealthRatio >= 0.5
              ? { symbol: '→', color: 'var(--watch)', label: 'partial' }
              : { symbol: '↓', color: 'var(--critical)', label: 'degraded' };

        // Sparse/silent regions from diagnostics
        const sparseDiagnosticCount = (coverageDiagnostics?.diagnosticCounts?.sourceSparseCountries || 0)
          + (coverageDiagnostics?.diagnosticCounts?.ingestionRiskCountries || 0);
        const sparseRegions = (coverageDiagnostics?.lowConfidenceRegions || [])
          .filter((r) => r.status === 'source-sparse' || r.status === 'ingestion-risk')
          .slice(0, 3);

        return (
          <div className="filter-drawer-body">
            {/* Data pipeline status — single compact strip */}
            <div className="filter-section">
              <div className="filter-label">DATA PIPELINE</div>
              <div className="coverage-grid">
                <div className="coverage-stat">
                  <span>Status</span>
                  <strong style={{ color: statusColor, textTransform: 'uppercase' }}>{dataStatus}</strong>
                </div>
                <div className="coverage-stat">
                  <span>Ingested</span>
                  <strong>{totalIngested}</strong>
                </div>
                <div className="coverage-stat">
                  <span>GDELT</span>
                  <strong style={{ color: gdeltHealthy > 0 ? 'var(--low)' : 'var(--critical)' }}>{gdeltHealthy}/{gdeltTotal}</strong>
                </div>
                <div className="coverage-stat">
                  <span>RSS Feeds</span>
                  <strong style={{ color: rssHealthy > rssTotal * 0.5 ? 'var(--low)' : 'var(--elevated)' }}>{rssHealthy}/{rssTotal}</strong>
                </div>
              </div>

              {/* Feed status strip */}
              {rssTotal > 0 && (
                <div className="feed-status-strip">
                  <span className="feed-status-count">
                    <strong style={{ color: feedTrendIndicator?.color }}>{rssHealthy}/{rssTotal}</strong>
                    {' '}feeds healthy
                  </span>
                  {feedTrendIndicator && (
                    <span className="feed-status-trend" style={{ color: feedTrendIndicator.color }}>
                      {feedTrendIndicator.symbol} {feedTrendIndicator.label}
                    </span>
                  )}
                  {rssFailed > 0 && (
                    <span className="feed-status-failed">{rssFailed} failed</span>
                  )}
                </div>
              )}
            </div>

            {/* Coverage overview */}
            <div className="filter-section">
              <div className="filter-label">{t('filters.coverage')}</div>
              <div className="coverage-progress">
                <div className="coverage-progress-bar"><span style={{ width: `${coveragePercent}%` }} /></div>
                <strong>{coveragePercent}%</strong>
              </div>
              <div className="coverage-grid">
                <div className="coverage-stat"><span>{t('filters.coveredCountries')}</span><strong>{coverageMetrics?.coveredCountries || 0}</strong></div>
                <div className="coverage-stat"><span>{t('filters.verifiedCountries')}</span><strong>{coverageMetrics?.verifiedCountries || 0}</strong></div>
                <div className="coverage-stat"><span>{t('filters.uncoveredCountries')}</span><strong>{coverageMetrics?.uncoveredCountries || 0}</strong></div>
                <div className="coverage-stat"><span>{t('filters.lowConfidenceRegions')}</span><strong>{diagnosticCounts.lowConfidenceCountries}</strong></div>
              </div>
            </div>

            {/* Sparse / silent regions note */}
            {sparseDiagnosticCount > 0 && (
              <div className="filter-section">
                <div className="filter-label">COVERAGE GAPS</div>
                <div className="intel-sparse-note">
                  <span className="intel-sparse-icon">⚠</span>
                  <span>
                    {sparseDiagnosticCount} region{sparseDiagnosticCount !== 1 ? 's' : ''} with sparse or silent coverage
                  </span>
                </div>
                {sparseRegions.length > 0 && (
                  <div className="coverage-gap-list" style={{ marginTop: '0.4rem' }}>
                    {sparseRegions.map((entry) => (
                      <button key={entry.iso} type="button" className="coverage-gap-item" onClick={() => onRegionSelect?.(entry.iso)}>
                        <span>{entry.region || entry.iso}</span>
                        <strong style={{ color: 'var(--elevated)', fontSize: '0.55rem', fontFamily: 'var(--font-mono)' }}>
                          {entry.status === 'ingestion-risk' ? 'INGEST RISK' : 'SPARSE'}
                        </strong>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Source breakdown */}
            <div className="filter-section">
              <div className="filter-label">{t('filters.sourceMix')}</div>
              <div className="coverage-mix">
                {Object.entries(sourceMix.summary).filter(([, count]) => count > 0).map(([type, count]) => (
                  <span key={type} className="coverage-chip">{count} {t(`sourceType.${type}`)}</span>
                ))}
              </div>
              <div className="coverage-language-line">
                <span>{t('filters.languages')}</span>
                <strong>{sourceMix.languageCount}</strong>
              </div>
            </div>

            {/* Low confidence regions — actionable */}
            {lowConfidenceRegions.length > 0 && (
              <div className="filter-section">
                <div className="filter-label">{t('filters.lowConfidenceRegions')}</div>
                <div className="coverage-gap-list">
                  {lowConfidenceRegions.slice(0, 5).map((entry) => (
                    <button key={entry.iso} type="button" className="coverage-gap-item" onClick={() => onRegionSelect?.(entry.iso)}>
                      <span>{entry.region || entry.iso}</span><strong>{entry.maxConfidence}%</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Trends — actionable */}
            {hasTrendData && (
              <div className="filter-section">
                <div className="filter-label">{t('filters.trendWatch')}</div>
                {risingRegions.length > 0 && (
                  <div className="coverage-gap-list">
                    {risingRegions.map((entry) => (
                      <button key={entry.iso} type="button" className="coverage-gap-item is-positive" onClick={() => onRegionSelect?.(entry.iso)}>
                        <span>{entry.region || entry.iso}</span>
                        <strong>{entry.eventDelta > 0 ? `+${entry.eventDelta}` : `+${entry.confidenceDelta}%`}</strong>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default FilterDrawer;
