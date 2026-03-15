import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe2, Map, RefreshCw, Search, Languages } from 'lucide-react';

const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'fr', label: 'FR' },
  { code: 'ar', label: 'AR' },
  { code: 'zh', label: 'ZH' }
];

const Header = ({
  searchQuery,
  onSearchChange,
  storyCount,
  regionCount,
  criticalCount,
  mapMode,
  onMapModeChange,
  dataSource,
  onRefresh
}) => {
  const { t, i18n } = useTranslation();

  const changeLanguage = (lang) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('mapr-lang', lang);
  };

  return (
    <header className="header">
      <div className="brand">
        <div className="brand-mark">
          <Globe2 size={14} />
        </div>
        <span className="brand-name">Mapr</span>
        <span className={`brand-live ${dataSource === 'loading' ? 'is-loading' : ''}`}>
          <span className="brand-live-dot" />
          {dataSource === 'live' ? t('header.live') : dataSource === 'loading' ? t('header.loading') : t('header.offline')}
        </span>
      </div>

      <label className="search-bar">
        <Search size={15} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('header.searchPlaceholder')}
        />
      </label>

      <div className="header-controls">
        <div className="map-toggle" role="tablist" aria-label="Map mode">
          <button
            type="button"
            role="tab"
            aria-selected={mapMode === 'globe'}
            className={`map-toggle-btn ${mapMode === 'globe' ? 'is-active' : ''}`}
            onClick={() => onMapModeChange('globe')}
          >
            <Globe2 size={13} />
            {t('header.globe')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mapMode === 'flat'}
            className={`map-toggle-btn ${mapMode === 'flat' ? 'is-active' : ''}`}
            onClick={() => onMapModeChange('flat')}
          >
            <Map size={13} />
            {t('header.flat')}
          </button>
        </div>

        <div className="lang-switcher">
          <Languages size={13} className="lang-switcher-icon" />
          <select
            value={i18n.language}
            onChange={(e) => changeLanguage(e.target.value)}
            aria-label="Language"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>{lang.label}</option>
            ))}
          </select>
        </div>

        <button
          className="refresh-btn"
          onClick={onRefresh}
          aria-label={t('header.refreshLabel')}
          title={t('header.refreshLabel')}
        >
          <RefreshCw size={14} className={dataSource === 'loading' ? 'spin' : ''} />
        </button>
      </div>

      <div className="header-stats">
        <div className="stat-chip">
          <strong>{regionCount}</strong>&nbsp;{t('header.regions')}
        </div>
        <div className="stat-chip">
          <strong>{storyCount}</strong>&nbsp;{t('header.stories')}
        </div>
        {criticalCount > 0 && (
          <div className="stat-chip is-critical">
            <strong>{criticalCount}</strong>&nbsp;{t('header.critical')}
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
