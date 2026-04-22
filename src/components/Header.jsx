import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import useFilterStore from '../stores/filterStore';
import useNewsStore from '../stores/newsStore';

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden>
      <svg width="20" height="20" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8.5" fill="none" stroke="var(--amber)" strokeWidth="1" />
        <path d="M10 1.5 L10 18.5 M1.5 10 L18.5 10" stroke="var(--amber)" strokeWidth="0.6" opacity="0.5" />
        <path d="M5 10 Q10 5 15 10 Q10 15 5 10 Z" fill="var(--amber)" />
        <circle cx="10" cy="10" r="1.5" fill="var(--bg-0)" />
      </svg>
    </div>
  );
}

const LANGS = ['en', 'es', 'fr', 'ar', 'zh'];
const OVERLAY_KEYS = [
  { key: 'severity', label: 'SEV' },
  { key: 'coverage', label: 'COV' },
  { key: 'geopolitical', label: 'GEO' },
];

/**
 * Design header — brand · search · overlay chips (only on `/`) · lang · ops.
 * Reads state directly from stores so it sits in the shared shell.
 */
export default function Header() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const inputRef = useRef(null);

  const searchQuery = useFilterStore((s) => s.searchQuery);
  const setSearchQuery = useFilterStore((s) => s.setSearchQuery);
  const mapOverlay = useFilterStore((s) => s.mapOverlay);
  const setMapOverlay = useFilterStore((s) => s.setMapOverlay);

  const opsHealth = useNewsStore((s) => s.opsHealth);
  const backendStatus = useNewsStore((s) => s.sourceHealth?.backend?.status);
  const status = opsHealth?.status ?? backendStatus ?? 'healthy';
  const opsOk = status === 'healthy' || status === 'ok';

  const isMap = location.pathname === '/';

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const cycleLang = () => {
    const idx = LANGS.indexOf(i18n.language);
    const next = LANGS[(idx + 1) % LANGS.length] || 'en';
    i18n.changeLanguage(next);
    try { localStorage.setItem('mapr-lang', next); } catch {}
  };

  return (
    <header className="app-header" role="banner">
      <div className="header-brand">
        <BrandMark />
        <span className="brand-title">MAPR</span>
        <span className="brand-build">v4.12 · OSINT</span>
      </div>

      <div className="header-search">
        <Search size={15} color="var(--ink-2)" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="QUERY · event, region, entity, source"
          aria-label={t('nav.ariaLabel')}
        />
        <span className="search-kbd" aria-hidden>⌘K</span>
      </div>

      {isMap && (
        <div className="header-overlays" role="group" aria-label="Map layers">
          <span className="micro">LAYERS</span>
          {OVERLAY_KEYS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className="toggle-chip"
              data-active={mapOverlay === key}
              aria-pressed={mapOverlay === key}
              onClick={() => setMapOverlay(mapOverlay === key ? null : key)}
              title={label}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="header-right">
        <button
          type="button"
          className="lang-select"
          onClick={cycleLang}
          title="Cycle language"
          aria-label="Cycle language"
        >
          LANG · <b>{i18n.language.toUpperCase()}</b>
        </button>
        <div className="op-badge" aria-live="polite">
          <span
            className="op-dot"
            style={{
              background: opsOk ? 'var(--sev-green)' : 'var(--sev-red)',
              boxShadow: `0 0 6px ${opsOk ? 'var(--sev-green)' : 'var(--sev-red)'}`,
            }}
          />
          OPS · {opsOk ? 'NOMINAL' : 'DEGRADED'}
        </div>
      </div>
    </header>
  );
}
