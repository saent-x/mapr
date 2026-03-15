import React from 'react';
import { useTranslation } from 'react-i18next';
import { DATE_WINDOWS, SORT_OPTIONS, getSeverityMeta } from '../utils/mockData';

const FilterDrawer = ({
  isOpen,
  dateWindow,
  setDateWindow,
  minSeverity,
  setMinSeverity,
  sortMode,
  setSortMode
}) => {
  const { t } = useTranslation();
  const sevMeta = getSeverityMeta(minSeverity);

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
    </div>
  );
};

export default FilterDrawer;
