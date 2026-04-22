import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { DATE_WINDOWS, SORT_OPTIONS } from '../utils/mockData';
import useFilterStore from '../stores/filterStore';

const VERIFICATION_OPTIONS = ['all', 'official', 'verified', 'developing', 'single-source'];
const SOURCE_TYPE_OPTIONS = ['all', 'official', 'wire', 'global', 'regional', 'local'];
const LANGUAGE_OPTIONS = ['all', 'en', 'es', 'fr', 'ar', 'zh'];

/**
 * FilterDrawer — tactical chip-style filter panel anchored top-left below the
 * drawer-toggles row. Wires directly into the filter store.
 */
const FilterDrawer = ({
  isOpen,
  onClose,
  filteredNews = [],
  allNews = [],
}) => {
  const { t } = useTranslation();

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
  };

  if (!isOpen) return null;

  return (
    <aside className="floating-panel filter-drawer" role="dialog" aria-label={t('filters.label')}>
      <div className="panel-header">
        <span className="dot" />
        {t('filters.label')}
        <span className="spacer" />
        <span style={{ color: 'var(--ink-2)' }}>{filteredNews.length}/{allNews.length}</span>
        <button type="button" onClick={onClose} aria-label={t('panel.closePanel')}><X size={12} aria-hidden /></button>
      </div>
      <div className="panel-body">
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
    </aside>
  );
};

export default FilterDrawer;
