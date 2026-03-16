import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
  onRegionSelect
}) => {
  const { t } = useTranslation();
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
    const summary = {
      official: 0,
      wire: 0,
      global: 0,
      regional: 0,
      local: 0,
      unknown: 0
    };
    const languages = new Set();

    filteredNews.forEach((story) => {
      const dominantType = story.sourceTypes?.includes('official')
        ? 'official'
        : story.sourceType || story.sourceTypes?.[0] || 'unknown';
      summary[dominantType] = (summary[dominantType] || 0) + 1;

      (story.languages || [story.language]).filter(Boolean).forEach((language) => {
        if (language !== 'unknown') {
          languages.add(language);
        }
      });
    });

    return { summary, languageCount: languages.size };
  }, [filteredNews]);
  const precisionMix = useMemo(() => {
    const summary = {
      locality: 0,
      country: 0,
      'source-country': 0,
      unknown: 0
    };

    filteredNews.forEach((story) => {
      const precision = story.geocodePrecision || 'unknown';
      summary[precision] = (summary[precision] || 0) + 1;
    });

    return summary;
  }, [filteredNews]);
  const lowConfidenceRegions = coverageDiagnostics?.lowConfidenceRegions || [];
  const ingestionRiskRegions = coverageDiagnostics?.ingestionRiskRegions || [];
  const sourceSparseRegions = coverageDiagnostics?.sourceSparseRegions || [];
  const sourceCoverageStats = sourceCoverageAudit?.stats || {
    countriesWithLocalFeeds: 0,
    countriesWithRegionalFeeds: 0,
    countriesWithoutLocalFeeds: 0,
    thinCoverageCountries: 0
  };
  const noLocalFeedCountries = sourceCoverageAudit?.noLocalFeedCountries || [];
  const thinLocalFeedCountries = sourceCoverageAudit?.thinLocalFeedCountries || [];
  const expansionTargets = sourceCoverageAudit?.expansionTargets || [];
  const diagnosticCounts = coverageDiagnostics?.diagnosticCounts || {
    lowConfidenceCountries: 0,
    ingestionRiskCountries: 0,
    sourceSparseCountries: 0
  };
  const risingRegions = coverageTrends?.risingRegions || [];
  const newlyVerifiedRegions = coverageTrends?.newlyVerifiedRegions || [];
  const atRiskTrendRegions = coverageTrends?.atRiskRegions || [];
  const hasTrendData = risingRegions.length > 0 || newlyVerifiedRegions.length > 0 || atRiskTrendRegions.length > 0;
  const historySnapshots = coverageHistory?.snapshots || [];
  const historyTransitions = coverageHistory?.transitions || [];
  const coveragePercent = Math.round((coverageMetrics?.coverageRate || 0) * 100);
  const opsAlerts = opsHealth?.alerts || [];
  const staleLagRegions = opsHealth?.regionLag?.staleRegions || [];
  const watchLagRegions = opsHealth?.regionLag?.watchRegions || [];
  const healthIssues = useMemo(() => {
    const issues = [];

    (sourceHealth?.gdelt?.profiles || []).forEach((profile) => {
      if (profile.status === 'ok') return;
      issues.push({
        id: `gdelt-${profile.id}`,
        scope: 'GDELT',
        name: profile.id,
        status: profile.status,
        detail: profile.error || `${profile.rawArticles} ${t('filters.results')}`
      });
    });

    (sourceHealth?.rss?.feeds || []).forEach((feed) => {
      if (feed.status === 'ok') return;
      issues.push({
        id: `rss-${feed.feedId}`,
        scope: 'RSS',
        name: feed.name,
        status: feed.status,
        detail: feed.error || `${feed.articleCount} ${t('header.stories')}`
      });
    });

    return issues.slice(0, 8);
  }, [sourceHealth, t]);

  return (
    <div className={`filter-drawer ${isOpen ? 'is-open' : ''}`}>
      <div className="filter-section">
        <div className="filter-label">{t('filters.timeRange')}</div>
        <div className="filter-chips">
          {DATE_WINDOWS.map((opt) => (
            <button
              key={opt.id}
              className={`chip ${dateWindow === opt.id ? 'is-active' : ''}`}
              onClick={() => setDateWindow(opt.id)}
            >
              {t(`filters.${opt.i18nKey}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-section">
        <div className="filter-label">{t('filters.sortBy')}</div>
        <div className="filter-chips">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={`chip ${sortMode === opt.id ? 'is-active' : ''}`}
              onClick={() => setSortMode(opt.id)}
            >
              {t(`filters.${opt.i18nKey}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-section">
        <div className="filter-label">{t('filters.mapOverlay')}</div>
        <div className="filter-chips">
          {['severity', 'coverage'].map((mode) => (
            <button
              key={mode}
              className={`chip ${mapOverlay === mode ? 'is-active' : ''}`}
              onClick={() => setMapOverlay(mode)}
            >
              {t(`legend.${mode}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-section">
        <div className="filter-label">{t('filters.verification')}</div>
        <div className="filter-chips">
          {VERIFICATION_OPTIONS.map((option) => (
            <button
              key={option}
              className={`chip ${verificationFilter === option ? 'is-active' : ''}`}
              onClick={() => setVerificationFilter(option)}
            >
              {option === 'all' ? t('filters.all') : t(`article.verificationStatus.${option}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-section">
        <div className="filter-label">{t('filters.accuracyMode')}</div>
        <div className="filter-chips">
          {ACCURACY_MODE_OPTIONS.map((option) => (
            <button
              key={option}
              className={`chip ${accuracyMode === option ? 'is-active' : ''}`}
              onClick={() => setAccuracyMode(option)}
            >
              {t(`filters.${option === 'strict' ? 'strictAccuracy' : 'standard'}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-section">
        <div className="filter-label">{t('filters.sourceType')}</div>
        <div className="filter-chips">
          {availableSourceTypes.map((option) => (
            <button
              key={option}
              className={`chip ${sourceTypeFilter === option ? 'is-active' : ''}`}
              onClick={() => setSourceTypeFilter(option)}
            >
              {option === 'all' ? t('filters.all') : t(`sourceType.${option}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-section">
        <div className="filter-label">{t('filters.language')}</div>
        <div className="filter-chips">
          {availableLanguages.map((option) => (
            <button
              key={option}
              className={`chip ${languageFilter === option ? 'is-active' : ''}`}
              onClick={() => setLanguageFilter(option)}
            >
              {option === 'all' ? t('filters.all') : (LANGUAGE_LABELS[option] || option.toUpperCase())}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-section">
        <div className="filter-label">{t('filters.locationPrecision')}</div>
        <div className="filter-chips">
          {availablePrecisions.map((option) => (
            <button
              key={option}
              className={`chip ${precisionFilter === option ? 'is-active' : ''}`}
              onClick={() => setPrecisionFilter(option)}
            >
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
        <input
          type="range"
          className="severity-slider-track"
          min="0"
          max="100"
          value={minSeverity}
          onChange={(e) => setMinSeverity(Number(e.target.value))}
        />
        <div className="severity-value">
          <span style={{ color: sevMeta.accent }}>{t(`legend.${sevMeta.labelKey}`)}</span>
        </div>
      </div>

      <div className="filter-section">
        <div className="filter-label">
          {t('filters.minConfidence')}
          <strong style={{ marginLeft: 'auto' }}>{minConfidence}%</strong>
        </div>
        <input
          type="range"
          className="severity-slider-track"
          min="0"
          max="100"
          step="5"
          value={minConfidence}
          onChange={(e) => setMinConfidence(Number(e.target.value))}
        />
        <div className="severity-value">
          <span>{t('article.confidence')}</span>
          <strong>{minConfidence}%</strong>
        </div>
      </div>

      <div className="filter-section">
        <div className="filter-label">{t('filters.coverage')}</div>
        <div className="coverage-progress">
          <div className="coverage-progress-bar">
            <span style={{ width: `${coveragePercent}%` }} />
          </div>
          <strong>{coveragePercent}%</strong>
        </div>
        <div className="coverage-grid">
          <div className="coverage-stat">
            <span>{t('filters.coveredCountries')}</span>
            <strong>{coverageMetrics?.coveredCountries || 0}</strong>
          </div>
          <div className="coverage-stat">
            <span>{t('filters.verifiedCountries')}</span>
            <strong>{coverageMetrics?.verifiedCountries || 0}</strong>
          </div>
          <div className="coverage-stat">
            <span>{t('filters.uncoveredCountries')}</span>
            <strong>{coverageMetrics?.uncoveredCountries || 0}</strong>
          </div>
          <div className="coverage-stat">
            <span>{t('filters.lowConfidenceRegions')}</span>
            <strong>{diagnosticCounts.lowConfidenceCountries}</strong>
          </div>
          <div className="coverage-stat">
            <span>{t('filters.ingestionRiskCountries')}</span>
            <strong>{diagnosticCounts.ingestionRiskCountries}</strong>
          </div>
          <div className="coverage-stat">
            <span>{t('filters.sourceSparseCountries')}</span>
            <strong>{diagnosticCounts.sourceSparseCountries}</strong>
          </div>
        </div>

        <div className="coverage-subsection">
          <div className="filter-label">{t('filters.sourceMix')}</div>
          <div className="coverage-mix">
            {Object.entries(sourceMix.summary)
              .filter(([, count]) => count > 0)
              .map(([type, count]) => (
                <span key={type} className="coverage-chip">
                  {count} {t(`sourceType.${type}`)}
                </span>
              ))}
          </div>
          <div className="coverage-language-line">
            <span>{t('filters.languages')}</span>
            <strong>{sourceMix.languageCount}</strong>
          </div>
        </div>

        <div className="coverage-subsection">
          <div className="filter-label">{t('filters.precisionMix')}</div>
          <div className="coverage-mix">
            {Object.entries(precisionMix)
              .filter(([, count]) => count > 0)
              .map(([precision, count]) => (
                <span key={precision} className="coverage-chip">
                  {count} {t(`precision.${precision}`)}
                </span>
              ))}
          </div>
        </div>

        <div className="coverage-subsection">
          <div className="filter-label">{t('filters.lowConfidenceRegions')}</div>
          {lowConfidenceRegions.length > 0 ? (
            <div className="coverage-gap-list">
              {lowConfidenceRegions.slice(0, 5).map((entry) => (
                <button
                  key={entry.iso}
                  type="button"
                  className="coverage-gap-item"
                  onClick={() => onRegionSelect?.(entry.iso)}
                >
                  <span>{entry.region || entry.iso}</span>
                  <strong>{entry.maxConfidence}%</strong>
                </button>
              ))}
            </div>
          ) : (
            <div className="coverage-empty">{t('filters.coverageClear')}</div>
          )}
        </div>

        <div className="coverage-subsection">
          <div className="filter-label">{t('filters.ingestionRiskCountries')}</div>
          {ingestionRiskRegions.length > 0 ? (
            <div className="coverage-gap-list">
              {ingestionRiskRegions.slice(0, 5).map((entry) => (
                <button
                  key={entry.iso}
                  type="button"
                  className="coverage-gap-item is-risk"
                  onClick={() => onRegionSelect?.(entry.iso)}
                >
                  <span>{entry.region || entry.iso}</span>
                  <strong>{entry.failedFeeds}/{entry.feedCount}</strong>
                </button>
              ))}
            </div>
          ) : (
            <div className="coverage-empty">{t('filters.noIngestionRisk')}</div>
          )}
        </div>

        <div className="coverage-subsection">
          <div className="filter-label">{t('filters.sourceSparseCountries')}</div>
          {sourceSparseRegions.length > 0 ? (
            <div className="coverage-gap-list">
              {sourceSparseRegions.slice(0, 5).map((entry) => (
                <button
                  key={entry.iso}
                  type="button"
                  className="coverage-gap-item is-sparse"
                  onClick={() => onRegionSelect?.(entry.iso)}
                >
                  <span>{entry.region || entry.iso}</span>
                  <strong>0</strong>
                </button>
              ))}
            </div>
          ) : (
            <div className="coverage-empty">{t('filters.noSourceSparse')}</div>
          )}
        </div>

        <div className="coverage-subsection">
          <div className="filter-label">{t('filters.sourceFootprint')}</div>
          <div className="coverage-grid">
            <div className="coverage-stat">
              <span>{t('filters.countriesWithLocalFeeds')}</span>
              <strong>{sourceCoverageStats.countriesWithLocalFeeds}</strong>
            </div>
            <div className="coverage-stat">
              <span>{t('filters.countriesWithRegionalFeeds')}</span>
              <strong>{sourceCoverageStats.countriesWithRegionalFeeds}</strong>
            </div>
            <div className="coverage-stat">
              <span>{t('filters.countriesWithoutLocalFeeds')}</span>
              <strong>{sourceCoverageStats.countriesWithoutLocalFeeds}</strong>
            </div>
          </div>
        </div>

        <div className="coverage-subsection">
          <div className="filter-label">{t('filters.expansionTargets')}</div>
          {expansionTargets.length > 0 ? (
            <div className="coverage-gap-list">
              {expansionTargets.slice(0, 6).map((entry) => (
                <button
                  key={entry.iso}
                  type="button"
                  className="coverage-gap-item is-sparse"
                  onClick={() => onRegionSelect?.(entry.iso)}
                >
                  <span>{entry.region || entry.iso}</span>
                  <strong>{entry.targetedFeedCount ?? entry.localFeedCount}</strong>
                </button>
              ))}
            </div>
          ) : (
            <div className="coverage-empty">{t('filters.noExpansionTargets')}</div>
          )}
        </div>

        <div className="coverage-subsection">
          <div className="filter-label">{t('filters.countriesWithoutLocalFeeds')}</div>
          {noLocalFeedCountries.length > 0 ? (
            <div className="coverage-gap-list">
              {noLocalFeedCountries.slice(0, 5).map((entry) => (
                <button
                  key={entry.iso}
                  type="button"
                  className="coverage-gap-item is-sparse"
                  onClick={() => onRegionSelect?.(entry.iso)}
                >
                  <span>{entry.region || entry.iso}</span>
                  <strong>0</strong>
                </button>
              ))}
            </div>
          ) : (
            <div className="coverage-empty">{t('filters.noMissingLocalFeeds')}</div>
          )}
        </div>

        <div className="coverage-subsection">
          <div className="filter-label">{t('filters.thinCoverageCountries')}</div>
          {thinLocalFeedCountries.length > 0 ? (
            <div className="coverage-gap-list">
              {thinLocalFeedCountries.slice(0, 5).map((entry) => (
                <button
                  key={entry.iso}
                  type="button"
                  className="coverage-gap-item"
                  onClick={() => onRegionSelect?.(entry.iso)}
                >
                  <span>{entry.region || entry.iso}</span>
                  <strong>{entry.targetedFeedCount ?? entry.localFeedCount}</strong>
                </button>
              ))}
            </div>
          ) : (
            <div className="coverage-empty">{t('filters.noThinCoverage')}</div>
          )}
        </div>
      </div>

      {coverageTrends && (
        <div className="filter-section">
          <div className="filter-label">{t('filters.trendWatch')}</div>
          {hasTrendData ? (
            <>
              {risingRegions.length > 0 && (
                <div className="coverage-subsection">
                  <div className="filter-label">{t('filters.risingRegions')}</div>
                  <div className="coverage-gap-list">
                    {risingRegions.map((entry) => (
                      <button
                        key={entry.iso}
                        type="button"
                        className="coverage-gap-item is-positive"
                        onClick={() => onRegionSelect?.(entry.iso)}
                      >
                        <span>{entry.region || entry.iso}</span>
                        <strong>{entry.eventDelta > 0 ? `+${entry.eventDelta}` : `+${entry.confidenceDelta}%`}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {newlyVerifiedRegions.length > 0 && (
                <div className="coverage-subsection">
                  <div className="filter-label">{t('filters.newlyVerifiedRegions')}</div>
                  <div className="coverage-gap-list">
                    {newlyVerifiedRegions.map((entry) => (
                      <button
                        key={entry.iso}
                        type="button"
                        className="coverage-gap-item is-positive"
                        onClick={() => onRegionSelect?.(entry.iso)}
                      >
                        <span>{entry.region || entry.iso}</span>
                        <strong>{entry.confidence}%</strong>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {atRiskTrendRegions.length > 0 && (
                <div className="coverage-subsection">
                  <div className="filter-label">{t('filters.atRiskRegions')}</div>
                  <div className="coverage-gap-list">
                    {atRiskTrendRegions.map((entry) => (
                      <button
                        key={entry.iso}
                        type="button"
                        className="coverage-gap-item is-risk"
                        onClick={() => onRegionSelect?.(entry.iso)}
                      >
                        <span>{entry.region || entry.iso}</span>
                        <strong>{entry.failedFeeds}/{entry.feedCount}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="coverage-empty">{t('filters.noTrendData')}</div>
          )}
        </div>
      )}

      {coverageHistory && (
        <div className="filter-section">
          <div className="filter-label">{t('filters.coverageTimeline')}</div>

          <div className="coverage-subsection">
            <div className="filter-label">{t('filters.recentSnapshots')}</div>
            {historySnapshots.length > 0 ? (
              <div className="history-snapshot-list">
                {historySnapshots.map((entry) => (
                  <div key={entry.at} className="history-snapshot-card">
                    <div className="history-snapshot-head">
                      <strong>{new Date(entry.at).toLocaleString()}</strong>
                    </div>
                    <div className="history-snapshot-stats">
                      <span>{entry.coveredCountries} {t('filters.coveredCountries')}</span>
                      <span>{entry.verifiedCountries} {t('filters.verifiedCountries')}</span>
                      <span>{entry.ingestionRiskCountries} {t('filters.ingestionRiskCountries')}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="coverage-empty">{t('filters.noCoverageTimeline')}</div>
            )}
          </div>

          <div className="coverage-subsection">
            <div className="filter-label">{t('filters.recentTransitions')}</div>
            {historyTransitions.length > 0 ? (
              <div className="coverage-gap-list">
                {historyTransitions.map((entry) => (
                  <button
                    key={`${entry.at}-${entry.iso}-${entry.toStatus}`}
                    type="button"
                    className={`coverage-gap-item ${entry.direction === 'down' ? 'is-risk' : 'is-positive'}`}
                    onClick={() => onRegionSelect?.(entry.iso)}
                  >
                    <span>{entry.region || entry.iso}</span>
                    <strong>
                      {t(`coverageStatus.${getCoverageLabelKey(entry.fromStatus)}`)}
                      {' -> '}
                      {t(`coverageStatus.${getCoverageLabelKey(entry.toStatus)}`)}
                    </strong>
                  </button>
                ))}
              </div>
            ) : (
              <div className="coverage-empty">{t('filters.noCoverageTimeline')}</div>
            )}
          </div>
        </div>
      )}

      <div className="filter-section">
        <div className="filter-label">{t('filters.sourceHealth')}</div>
        {(sourceHealth?.gdelt || sourceHealth?.rss || sourceHealth?.backend) ? (
          <>
            <div className="health-grid">
              <div className="health-stat">
                <span>{t('filters.backendStatus')}</span>
                <strong>
                  {sourceHealth?.backend?.status
                    ? t(`healthStatus.${sourceHealth.backend.status}`)
                    : '—'}
                </strong>
              </div>
              <div className="health-stat">
                <span>{t('filters.gdeltHealthy')}</span>
                <strong>
                  {sourceHealth?.gdelt?.healthyProfiles || 0}
                  /
                  {sourceHealth?.gdelt?.totalProfiles || 0}
                </strong>
              </div>
              <div className="health-stat">
                <span>{t('filters.gdeltFailed')}</span>
                <strong>{sourceHealth?.gdelt?.failedProfiles || 0}</strong>
              </div>
              <div className="health-stat">
                <span>{t('filters.rssHealthy')}</span>
                <strong>
                  {sourceHealth?.rss?.healthyFeeds || 0}
                  /
                  {sourceHealth?.rss?.totalFeeds || 0}
                </strong>
              </div>
              <div className="health-stat">
                <span>{t('filters.rssFailed')}</span>
                <strong>{sourceHealth?.rss?.failedFeeds || 0}</strong>
              </div>
            </div>

            <div className="health-summary-line">
              <span>{t('filters.ingestedRecords')}</span>
              <strong>
                {(sourceHealth?.gdelt?.normalizedArticles || 0) + (sourceHealth?.rss?.articlesFound || 0)}
              </strong>
            </div>

            <div className="health-summary-line">
              <span>{t('filters.lastSuccess')}</span>
              <strong>
                {sourceHealth?.backend?.lastSuccessAt
                  ? new Date(sourceHealth.backend.lastSuccessAt).toLocaleTimeString()
                  : '—'}
              </strong>
            </div>

            <div className="health-subsection">
              <div className="filter-label">{t('filters.opsAlerts')}</div>
              {opsAlerts.length > 0 ? (
                <div className="health-issue-list">
                  {opsAlerts.map((alert) => (
                    <div key={alert.id} className="health-issue-item">
                      <div className="health-issue-head">
                        <span className="health-issue-scope">{alert.scope}</span>
                        <span className={`health-issue-status is-${alert.severity}`}>
                          {t(`opsSeverity.${alert.severity}`)}
                        </span>
                      </div>
                      <strong>{t(`opsAlert.${alert.code}.title`, alert.vars || {})}</strong>
                      <span>{t(`opsAlert.${alert.code}.detail`, alert.vars || {})}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="health-empty">{t('filters.noOpsAlerts')}</div>
              )}
            </div>

            <div className="health-subsection">
              <div className="filter-label">{t('filters.regionLag')}</div>

              {staleLagRegions.length > 0 && (
                <div className="coverage-subsection">
                  <div className="filter-label">{t('filters.staleRegionLag')}</div>
                  <div className="coverage-gap-list">
                    {staleLagRegions.slice(0, 5).map((entry) => (
                      <button
                        key={entry.iso}
                        type="button"
                        className="coverage-gap-item is-risk"
                        onClick={() => onRegionSelect?.(entry.iso)}
                      >
                        <span>{entry.region || entry.iso}</span>
                        <strong>{entry.ageHours}h</strong>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {watchLagRegions.length > 0 && (
                <div className="coverage-subsection">
                  <div className="filter-label">{t('filters.watchRegionLag')}</div>
                  <div className="coverage-gap-list">
                    {watchLagRegions.slice(0, 5).map((entry) => (
                      <button
                        key={entry.iso}
                        type="button"
                        className="coverage-gap-item"
                        onClick={() => onRegionSelect?.(entry.iso)}
                      >
                        <span>{entry.region || entry.iso}</span>
                        <strong>{entry.ageHours}h</strong>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {staleLagRegions.length === 0 && watchLagRegions.length === 0 && (
                <div className="health-empty">{t('filters.noRegionLag')}</div>
              )}
            </div>

            <div className="health-subsection">
              <div className="filter-label">{t('filters.sourceIssues')}</div>
              {healthIssues.length > 0 ? (
                <div className="health-issue-list">
                  {healthIssues.map((issue) => (
                    <div key={issue.id} className="health-issue-item">
                      <div className="health-issue-head">
                        <span className="health-issue-scope">{issue.scope}</span>
                        <span className={`health-issue-status is-${issue.status}`}>
                          {t(`healthStatus.${issue.status}`)}
                        </span>
                      </div>
                      <strong>{issue.name}</strong>
                      <span>{issue.detail}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="health-empty">{t('filters.noSourceIssues')}</div>
              )}
            </div>

            {opsHealth && (
              <div className="health-subsection">
                <div className="filter-label">{t('filters.refreshHistory')}</div>
                {opsHealth.history?.length > 0 ? (
                  <div className="health-issue-list">
                    {opsHealth.history.slice(0, 6).map((entry) => (
                      <div key={`${entry.at}-${entry.status}`} className="health-issue-item">
                        <div className="health-issue-head">
                          <span className="health-issue-scope">{new Date(entry.at).toLocaleString()}</span>
                          <span className={`health-issue-status is-${entry.status === 'ok' ? 'healthy' : 'failed'}`}>
                            {entry.status === 'ok' ? t('healthStatus.healthy') : t('healthStatus.failed')}
                          </span>
                        </div>
                        <strong>{entry.reason}</strong>
                        <span>
                          {entry.durationMs}ms
                          {' · '}
                          {entry.articleCount} {t('header.stories')}
                          {' · '}
                          {entry.eventCount} {t('filters.results')}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="health-empty">{t('filters.noRefreshHistory')}</div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="health-empty">{t('filters.noHealthData')}</div>
        )}
      </div>
    </div>
  );
};

export default FilterDrawer;
