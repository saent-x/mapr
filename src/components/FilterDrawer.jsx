import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { DATE_WINDOWS, SORT_OPTIONS } from '../utils/mockData';
import useFilterStore from '../stores/filterStore';
import useUIStore from '../stores/uiStore';
import useBreakpoint from '../hooks/useBreakpoint';
import BottomSheet from './ui/BottomSheet';

const VERIFICATION_OPTIONS = ['all', 'official', 'verified', 'developing', 'single-source'];
const SOURCE_TYPE_OPTIONS = ['all', 'official', 'wire', 'global', 'regional', 'local'];
const LANGUAGE_OPTIONS = ['all', 'en', 'es', 'fr', 'ar', 'zh'];

const FilterDrawer = ({
  isOpen,
  defaultTab = 'filters',
  onClose,
  filteredNews = [],
  allNews = [],
  sourceCoverageAudit,
  coverageMetrics,
  coverageDiagnostics,
  coverageTrends,
  coverageHistory,
  opsHealth,
  sourceHealth,
  onRegionSelect,
}) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState(defaultTab === 'intel' ? 'intel' : 'filters');
  const { isMobile } = useBreakpoint();

  useEffect(() => {
    if (isOpen) setTab(defaultTab === 'intel' ? 'intel' : 'filters');
  }, [isOpen, defaultTab]);

  const dateWindow = useFilterStore((s) => s.dateWindow);
  const setDateWindow = useFilterStore((s) => s.setDateWindow);
  const minSeverity = useFilterStore((s) => s.minSeverity);
  const setMinSeverity = useFilterStore((s) => s.setMinSeverity);
  const minConfidence = useFilterStore((s) => s.minConfidence);
  const setMinConfidence = useFilterStore((s) => s.setMinConfidence);
  const sortMode = useFilterStore((s) => s.sortMode);
  const setSortMode = useFilterStore((s) => s.setSortMode);
  const verificationFilter = useFilterStore((s) => s.verificationFilter);
  const setVerificationFilter = useFilterStore((s) => s.setVerificationFilter);
  const sourceTypeFilter = useFilterStore((s) => s.sourceTypeFilter);
  const setSourceTypeFilter = useFilterStore((s) => s.setSourceTypeFilter);
  const languageFilter = useFilterStore((s) => s.languageFilter);
  const setLanguageFilter = useFilterStore((s) => s.setLanguageFilter);
  const hideAmplified = useFilterStore((s) => s.hideAmplified);
  const setHideAmplified = useFilterStore((s) => s.setHideAmplified);
  const clearEntityFilter = useFilterStore((s) => s.clearEntityFilter);

  const selectRegion = useUIStore((s) => s.selectRegion);

  const windowOptions = DATE_WINDOWS || [
    { id: '24h', label: '24H' },
    { id: '72h', label: '72H' },
    { id: '168h', label: '7D' },
    { id: '720h', label: '30D' },
  ];

  const sevCounts = useMemo(() => {
    const all = allNews;
    return {
      black: all.filter((e) => (e.severity ?? 0) >= 85).length,
      red: all.filter((e) => (e.severity ?? 0) >= 70 && (e.severity ?? 0) < 85).length,
      amber: all.filter((e) => (e.severity ?? 0) >= 40 && (e.severity ?? 0) < 70).length,
      green: all.filter((e) => (e.severity ?? 0) < 40).length,
    };
  }, [allNews]);

  const reset = () => {
    setMinSeverity(0);
    setMinConfidence(0);
    setDateWindow('168h');
    setVerificationFilter('all');
    setSourceTypeFilter('all');
    setLanguageFilter('all');
    setHideAmplified(false);
    clearEntityFilter();
    selectRegion(null);
  };

  if (!isOpen) return null;

  const content = (
    <>
      <div className="panel-header">
        <span className="dot" />
        {t('filters.label')}
        <span className="spacer" />
        <span style={{ color: 'var(--ink-2)' }}>{filteredNews.length}/{allNews.length}</span>
        <button type="button" onClick={onClose} aria-label={t('panel.closePanel')}><X size={12} aria-hidden /></button>
      </div>

      <div className="filter-section" role="tablist" aria-label="Drawer tabs">
        <div className="chip-row">
          <button
            type="button"
            role="tab"
            className="chip"
            data-active={tab === 'filters'}
            aria-selected={tab === 'filters'}
            aria-controls="filter-drawer-filters"
            onClick={() => setTab('filters')}
          >
            FILTERS
          </button>
          <button
            type="button"
            role="tab"
            className="chip"
            data-active={tab === 'intel'}
            aria-selected={tab === 'intel'}
            aria-controls="filter-drawer-intel"
            onClick={() => setTab('intel')}
          >
            INTEL
          </button>
        </div>
      </div>

      {tab === 'filters' && (
        <div className="panel-body" id="filter-drawer-filters" role="tabpanel">
          <div className="filter-section">
            <span className="micro">Severity tier</span>
            <div className="chip-row">
              {[
                { key: 'black', min: 85, label: 'BLACK', count: sevCounts.black },
                { key: 'red', min: 70, label: 'RED', count: sevCounts.red },
                { key: 'amber', min: 40, label: 'AMBER', count: sevCounts.amber },
                { key: 'green', min: 0, label: 'GREEN', count: sevCounts.green },
              ].map(({ key, min, label, count }) => (
                <button
                  key={key}
                  type="button"
                  className="chip"
                  data-active={minSeverity === min}
                  aria-pressed={minSeverity === min}
                  aria-label={`Minimum severity ${label}`}
                  onClick={() => setMinSeverity(minSeverity === min ? 0 : min)}
                >
                  {label} <span className="ct">{count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <span className="micro">Score ≥ <b className="mono" style={{ color: 'var(--ink-0)' }}>{minSeverity}</b></span>
            <div className="slider">
              <span style={{ color: 'var(--ink-2)' }}>0</span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={minSeverity}
                aria-label="Minimum severity score"
                onChange={(e) => setMinSeverity(Number(e.target.value))}
              />
              <span style={{ color: 'var(--ink-2)' }}>100</span>
            </div>
          </div>

          <div className="filter-section">
            <span className="micro">Confidence ≥ <b className="mono" style={{ color: 'var(--ink-0)' }}>{minConfidence}</b></span>
            <div className="slider">
              <span style={{ color: 'var(--ink-2)' }}>0</span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={minConfidence}
                aria-label="Minimum confidence score"
                onChange={(e) => setMinConfidence(Number(e.target.value))}
              />
              <span style={{ color: 'var(--ink-2)' }}>100</span>
            </div>
          </div>

          <div className="filter-section">
            <span className="micro">Time window</span>
            <div className="chip-row">
              {windowOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className="chip"
                  data-active={dateWindow === opt.id}
                  aria-pressed={dateWindow === opt.id}
                  aria-label={`Window ${opt.label}`}
                  onClick={() => setDateWindow(opt.id)}
                >
                  {opt.label.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <span className="micro">Source tier</span>
            <div className="chip-row">
              {SOURCE_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className="chip"
                  data-active={sourceTypeFilter === opt}
                  aria-pressed={sourceTypeFilter === opt}
                  aria-label={`Source tier ${opt}`}
                  onClick={() => setSourceTypeFilter(opt)}
                >
                  {opt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <span className="micro">Verification</span>
            <div className="chip-row">
              {VERIFICATION_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className="chip"
                  data-active={verificationFilter === opt}
                  aria-pressed={verificationFilter === opt}
                  aria-label={`Verification ${opt}`}
                  onClick={() => setVerificationFilter(opt)}
                >
                  {opt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <span className="micro">Language</span>
            <div className="chip-row">
              {LANGUAGE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className="chip"
                  data-active={languageFilter === opt}
                  aria-pressed={languageFilter === opt}
                  aria-label={`Language ${opt}`}
                  onClick={() => setLanguageFilter(opt)}
                >
                  {opt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <span className="micro">Sort order</span>
            <div className="chip-row">
              {(SORT_OPTIONS || [{ id: 'severity', label: 'Severity' }]).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className="chip"
                  data-active={sortMode === opt.id}
                  aria-pressed={sortMode === opt.id}
                  aria-label={`Sort by ${opt.label}`}
                  onClick={() => setSortMode(opt.id)}
                >
                  {opt.label.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              aria-label="Hide amplified articles"
            >
              <input
                type="checkbox"
                checked={hideAmplified}
                onChange={(e) => setHideAmplified(e.target.checked)}
                aria-label="Hide amplified articles"
              />
              <span className="mono" style={{ fontSize: 'var(--fs-1)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-1)' }}>
                Hide amplified
              </span>
            </label>
          </div>

          <div className="filter-section" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn"
              aria-label="Reset filters"
              onClick={reset}
            >
              RESET
            </button>
            <button
              type="button"
              className="btn primary"
              aria-label="Apply filters"
              onClick={onClose}
            >
              APPLY
            </button>
          </div>
        </div>
      )}

      {tab === 'intel' && (
        <div className="panel-body" id="filter-drawer-intel" role="tabpanel">
          <IntelTab
            sourceHealth={sourceHealth}
            coverageMetrics={coverageMetrics}
            coverageDiagnostics={coverageDiagnostics}
            coverageTrends={coverageTrends}
            coverageHistory={coverageHistory}
            sourceCoverageAudit={sourceCoverageAudit}
            opsHealth={opsHealth}
            onRegionSelect={onRegionSelect}
          />
        </div>
      )}
    </>
  );

  if (isMobile) {
    return (
      <BottomSheet
        open={isOpen}
        onClose={onClose}
        title={t('filters.label')}
        ariaLabel={t('filters.label')}
        heightVh={90}
      >
        <div className="filter-drawer filter-drawer-mobile">{content}</div>
      </BottomSheet>
    );
  }

  return (
    <aside className="floating-panel filter-drawer" role="dialog" aria-label={t('filters.label')}>
      {content}
    </aside>
  );
};

const IntelRow = ({ label, value, color }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '2px 0' }}>
    <span className="micro" style={{ marginBottom: 0 }}>{label}</span>
    <b className="mono" style={{ color: color || 'var(--ink-0)', fontSize: 'var(--fs-1)' }}>{value}</b>
  </div>
);

const IntelGapButton = ({ entry, suffix, onSelect }) => (
  <button
    type="button"
    className="chip"
    style={{ justifyContent: 'space-between', width: '100%', marginBottom: 3 }}
    onClick={() => onSelect?.(entry.iso)}
    aria-label={`Select ${entry.region || entry.iso}`}
  >
    <span>{entry.region || entry.iso}</span>
    <span className="ct">{suffix}</span>
  </button>
);

const IntelTab = ({
  sourceHealth,
  coverageMetrics,
  coverageDiagnostics,
  coverageTrends,
  coverageHistory,
  sourceCoverageAudit,
  opsHealth,
  onRegionSelect,
}) => {
  const gdeltHealthy = sourceHealth?.gdelt?.healthyProfiles || 0;
  const gdeltTotal = sourceHealth?.gdelt?.totalProfiles || 0;
  const rssHealthy = sourceHealth?.rss?.healthyFeeds || 0;
  const rssTotal = sourceHealth?.rss?.totalFeeds || 0;
  const rssFailed = sourceHealth?.rss?.failedFeeds || 0;
  const totalIngested = (sourceHealth?.gdelt?.normalizedArticles || 0) + (sourceHealth?.rss?.articlesFound || 0);
  const dataStatus = gdeltTotal === 0 && rssTotal === 0
    ? 'OFFLINE'
    : (gdeltHealthy === 0 && rssHealthy < rssTotal * 0.5) ? 'DEGRADED' : 'OPERATIONAL';
  const statusColor = dataStatus === 'OPERATIONAL'
    ? 'var(--sev-green, #5ec269)'
    : dataStatus === 'DEGRADED'
      ? 'var(--amber, #d9a441)'
      : 'var(--sev-red, #d25757)';

  const coveragePercent = Math.round((coverageMetrics?.coverageRate || 0) * 100);
  const diagnosticCounts = coverageDiagnostics?.diagnosticCounts || {
    lowConfidenceCountries: 0, ingestionRiskCountries: 0, sourceSparseCountries: 0,
  };
  const lowConfidenceRegions = coverageDiagnostics?.lowConfidenceRegions || [];
  const risingRegions = coverageTrends?.risingRegions || [];
  const newlyVerifiedRegions = coverageTrends?.newlyVerifiedRegions || [];
  const atRiskRegions = coverageTrends?.atRiskRegions || [];
  const auditStats = sourceCoverageAudit?.stats || null;
  const expansionTargets = (sourceCoverageAudit?.expansionTargets || []).slice(0, 5);

  const opsStatus = opsHealth?.status ? String(opsHealth.status).toUpperCase() : null;
  const opsStatusColor = opsStatus === 'OK'
    ? 'var(--sev-green, #5ec269)'
    : opsStatus === 'DEGRADED'
      ? 'var(--amber, #d9a441)'
      : opsStatus
        ? 'var(--sev-red, #d25757)'
        : 'var(--ink-2)';

  const historyPoints = Array.isArray(coverageHistory) ? coverageHistory.slice(-6) : [];

  return (
    <>
      <div className="filter-section">
        <span className="micro">Data pipeline</span>
        <IntelRow label="Status" value={dataStatus} color={statusColor} />
        <IntelRow label="Ingested" value={totalIngested} />
        <IntelRow label="GDELT" value={`${gdeltHealthy}/${gdeltTotal}`} color={gdeltHealthy > 0 ? 'var(--ink-0)' : 'var(--sev-red, #d25757)'} />
        <IntelRow label="RSS feeds" value={`${rssHealthy}/${rssTotal}`} color={rssTotal > 0 && rssHealthy > rssTotal * 0.5 ? 'var(--ink-0)' : 'var(--amber, #d9a441)'} />
        {rssFailed > 0 && <IntelRow label="Failed" value={rssFailed} color="var(--sev-red, #d25757)" />}
      </div>

      {opsHealth && (
        <div className="filter-section">
          <span className="micro">Ops health</span>
          <IntelRow label="Backend" value={opsStatus || 'UNKNOWN'} color={opsStatusColor} />
          {opsHealth.latencyMs != null && <IntelRow label="Latency" value={`${opsHealth.latencyMs}ms`} />}
          {opsHealth.uptimeSeconds != null && <IntelRow label="Uptime" value={`${Math.round(opsHealth.uptimeSeconds / 60)}m`} />}
          {opsHealth.lastError && (
            <div className="micro" style={{ color: 'var(--sev-red, #d25757)', marginTop: 4 }}>
              {String(opsHealth.lastError).slice(0, 80)}
            </div>
          )}
        </div>
      )}

      <div className="filter-section">
        <span className="micro">Coverage <b className="mono" style={{ color: 'var(--ink-0)' }}>{coveragePercent}%</b></span>
        <div
          aria-hidden
          style={{ height: 3, background: 'var(--line)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}
        >
          <div style={{ width: `${coveragePercent}%`, height: '100%', background: 'var(--amber, #d9a441)' }} />
        </div>
        <IntelRow label="Covered" value={coverageMetrics?.coveredCountries || 0} />
        <IntelRow label="Verified" value={coverageMetrics?.verifiedCountries || 0} />
        <IntelRow label="Uncovered" value={coverageMetrics?.uncoveredCountries || 0} />
        <IntelRow label="Low confidence" value={diagnosticCounts.lowConfidenceCountries || 0} />
        <IntelRow label="Ingest risk" value={diagnosticCounts.ingestionRiskCountries || 0} />
        <IntelRow label="Source sparse" value={diagnosticCounts.sourceSparseCountries || 0} />
      </div>

      {auditStats && (
        <div className="filter-section">
          <span className="micro">Source audit</span>
          <IntelRow label="With local feeds" value={auditStats.countriesWithLocalFeeds || 0} />
          <IntelRow label="With regional feeds" value={auditStats.countriesWithRegionalFeeds || 0} />
          <IntelRow label="Without local" value={auditStats.countriesWithoutLocalFeeds || 0} color="var(--amber, #d9a441)" />
          <IntelRow label="Thin coverage" value={auditStats.thinCoverageCountries || 0} />
          {expansionTargets.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <span className="micro" style={{ marginBottom: 4 }}>Expansion targets</span>
              {expansionTargets.map((entry) => (
                <IntelGapButton
                  key={entry.iso}
                  entry={entry}
                  suffix={`${entry.targetedFeedCount}F`}
                  onSelect={onRegionSelect}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {lowConfidenceRegions.length > 0 && (
        <div className="filter-section">
          <span className="micro">Low-confidence regions</span>
          {lowConfidenceRegions.slice(0, 5).map((entry) => (
            <IntelGapButton
              key={entry.iso}
              entry={entry}
              suffix={`${entry.maxConfidence ?? 0}%`}
              onSelect={onRegionSelect}
            />
          ))}
        </div>
      )}

      {(risingRegions.length > 0 || newlyVerifiedRegions.length > 0 || atRiskRegions.length > 0) && (
        <div className="filter-section">
          <span className="micro">Trend watch</span>
          {risingRegions.slice(0, 3).map((entry) => (
            <IntelGapButton
              key={`rise-${entry.iso}`}
              entry={entry}
              suffix={entry.eventDelta > 0 ? `+${entry.eventDelta}` : `+${entry.confidenceDelta || 0}%`}
              onSelect={onRegionSelect}
            />
          ))}
          {newlyVerifiedRegions.slice(0, 3).map((entry) => (
            <IntelGapButton
              key={`verify-${entry.iso}`}
              entry={entry}
              suffix="VERIFIED"
              onSelect={onRegionSelect}
            />
          ))}
          {atRiskRegions.slice(0, 3).map((entry) => (
            <IntelGapButton
              key={`risk-${entry.iso}`}
              entry={entry}
              suffix="AT RISK"
              onSelect={onRegionSelect}
            />
          ))}
        </div>
      )}

      {historyPoints.length > 0 && (
        <div className="filter-section">
          <span className="micro">Coverage history</span>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 32 }}>
            {historyPoints.map((point, i) => {
              const rate = typeof point?.coverageRate === 'number'
                ? point.coverageRate
                : typeof point?.rate === 'number' ? point.rate : 0;
              const pct = Math.max(2, Math.round(rate * 100));
              return (
                <div
                  key={i}
                  title={`${pct}%`}
                  style={{ flex: 1, height: `${pct}%`, background: 'var(--amber, #d9a441)', opacity: 0.7 }}
                />
              );
            })}
          </div>
        </div>
      )}
    </>
  );
};

export default FilterDrawer;
