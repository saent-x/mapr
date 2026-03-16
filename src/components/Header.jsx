import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe2, Map as MapIcon, RefreshCw, Search, Languages, MapPin, Newspaper, X, ExternalLink } from 'lucide-react';
import { getSeverityMeta } from '../utils/mockData';
import { getSourceHost } from '../utils/urlUtils';

const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'fr', label: 'FR' },
  { code: 'ar', label: 'AR' },
  { code: 'zh', label: 'ZH' }
];

const BACKEND_STATUS_CONFIG = {
  healthy: { tone: 'is-healthy', labelKey: 'healthy' },
  degraded: { tone: 'is-degraded', labelKey: 'degraded' },
  stale: { tone: 'is-stale', labelKey: 'stale' }
};

const Header = ({
  searchQuery,
  onSearchChange,
  onSearchSelect,
  newsList = [],
  regionSeverities = {},
  storyCount,
  regionCount,
  verifiedCount = 0,
  criticalCount,
  mapMode,
  onMapModeChange,
  dataSource,
  onRefresh,
  backendStatus = null
}) => {
  const { t, i18n } = useTranslation();
  const [showResults, setShowResults] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRef = useRef(null);
  const resultsRef = useRef(null);

  const changeLanguage = (lang) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('mapr-lang', lang);
  };

  // Build search results: regions + stories
  const searchResults = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (q.length < 2) return [];

    const results = [];

    // Region matches — deduplicate by isoA2, match on region name
    const regionMatches = new Map();
    for (const story of newsList) {
      if (regionMatches.has(story.isoA2)) continue;
      const regionName = (story.region || '').toLowerCase();
      if (regionName.includes(q)) {
        const rd = regionSeverities[story.isoA2];
        regionMatches.set(story.isoA2, {
          type: 'region',
          iso: story.isoA2,
          name: story.region,
          count: rd?.count || 0,
          severity: rd?.peakSeverity || 0,
        });
      }
    }
    // Sort regions by story count desc
    const regions = [...regionMatches.values()].sort((a, b) => b.count - a.count);
    results.push(...regions.slice(0, 5));

    // Story matches — match on title, summary, locality, category
    const storyMatches = [];
    for (const story of newsList) {
      const haystack = [story.title, story.summary, story.locality, story.category]
        .join(' ').toLowerCase();
      if (haystack.includes(q)) {
        storyMatches.push({ type: 'story', story });
      }
      if (storyMatches.length >= 8) break;
    }
    results.push(...storyMatches);

    return results;
  }, [searchQuery, newsList, regionSeverities]);

  // Show/hide dropdown
  const queryLen = (searchQuery || '').trim().length;
  const showEmpty = queryLen >= 2 && searchResults.length === 0;
  useEffect(() => {
    setShowResults(queryLen >= 2);
    setActiveIndex(-1);
  }, [searchResults, queryLen]);

  // Click outside to close
  useEffect(() => {
    const handleClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = useCallback((result) => {
    if (result.type === 'region') {
      onSearchSelect({ type: 'region', iso: result.iso });
    } else {
      onSearchSelect({ type: 'story', story: result.story });
    }
    setShowResults(false);
    onSearchChange('');
  }, [onSearchSelect, onSearchChange]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (!showResults || searchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(searchResults[activeIndex]);
    } else if (e.key === 'Escape') {
      setShowResults(false);
    }
  }, [showResults, searchResults, activeIndex, handleSelect]);

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && resultsRef.current) {
      const item = resultsRef.current.children[activeIndex];
      if (item) item.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const handleClear = () => {
    onSearchChange('');
    setShowResults(false);
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
        {backendStatus && BACKEND_STATUS_CONFIG[backendStatus] && (() => {
          const cfg = BACKEND_STATUS_CONFIG[backendStatus];
          return (
            <span className={`brand-backend ${cfg.tone}`}>
              {t(`healthStatus.${cfg.labelKey}`)}
            </span>
          );
        })()}
      </div>

      <div className="search-wrapper" ref={searchRef}>
        <label className="search-bar">
          <Search size={15} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowResults(true)}
            onKeyDown={handleKeyDown}
            placeholder={t('header.searchPlaceholder')}
          />
          {searchQuery && (
            <button className="search-clear" onClick={handleClear} aria-label="Clear search">
              <X size={13} />
            </button>
          )}
        </label>

        {showResults && (
          <div className="search-results" ref={resultsRef}>
            {showEmpty && (
              <div className="search-empty">
                No results for &ldquo;{searchQuery.trim()}&rdquo;
              </div>
            )}
            {searchResults.map((result, idx) => {
              if (result.type === 'region') {
                const meta = getSeverityMeta(result.severity);
                return (
                  <button
                    key={`r-${result.iso}`}
                    className={`search-result ${idx === activeIndex ? 'is-active' : ''}`}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <MapPin size={13} style={{ color: meta.accent, flexShrink: 0 }} />
                    <div className="search-result-text">
                      <span className="search-result-title">{result.name}</span>
                      <span className="search-result-meta">
                        <span className="search-result-dot" style={{ background: meta.accent }} />
                        {result.count} {t('header.stories')}
                      </span>
                    </div>
                  </button>
                );
              } else {
                const { story } = result;
                const meta = getSeverityMeta(story.severity);
                const sourceLabel = getSourceHost(story.url, story.source || t('article.readFull'));
                return (
                  <div
                    key={`s-${story.id}`}
                    className={`search-result-row ${idx === activeIndex ? 'is-active' : ''}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <button
                      className={`search-result ${idx === activeIndex ? 'is-active' : ''}`}
                      onClick={() => handleSelect(result)}
                    >
                      <Newspaper size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                      <div className="search-result-text">
                        <span className="search-result-title">{story.title}</span>
                        <span className="search-result-meta">
                          <span className="search-result-dot" style={{ background: meta.accent }} />
                          {story.locality || story.region}
                        </span>
                      </div>
                    </button>
                    {story.url && (
                      <a
                        className="search-result-link"
                        href={story.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('article.readFull')}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={12} />
                        {sourceLabel}
                      </a>
                    )}
                  </div>
                );
              }
            })}
          </div>
        )}
      </div>

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
            <MapIcon size={13} />
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
        {verifiedCount > 0 && (
          <div className="stat-chip is-verified">
            <strong>{verifiedCount}</strong>&nbsp;{t('header.verified')}
          </div>
        )}
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
