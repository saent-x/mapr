import React, { useEffect, useRef, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, Menu, X, LogOut, LogIn, Sun, Moon, RefreshCw, Share2 } from 'lucide-react';
import useFilterStore from '../stores/filterStore';
import useNewsStore from '../stores/newsStore';
import useUIStore from '../stores/uiStore';
import useBreakpoint from '../hooks/useBreakpoint';
import useDataFreshness from '../hooks/useDataFreshness';
import db from '../services/instantDb';
import { toggleTheme as toggleAppTheme } from '../utils/theme';

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

  const { user, isLoading: authLoading } = db.useAuth();
  const clearSavedViews = useUIStore((s) => s.deleteView);

  const isMap = location.pathname === '/';

  const { isMobile, isTablet } = useBreakpoint();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [appTheme, setAppTheme] = useState(() =>
    (typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null) || 'dark',
  );

  /* ── Data freshness for refresh button tooltip ── */
  const { ageValue, ageUnit, ageColor, lastLoadTime } = useDataFreshness();
  const [refreshing, setRefreshing] = useState(false);
  const addToast = useUIStore((s) => s.addToast);

  const freshnessTooltip = ageValue != null && ageUnit
    ? t(`freshness.${ageUnit === 's' ? 'secondsAgo' : ageUnit === 'm' ? 'minutesAgo' : ageUnit === 'h' ? 'hoursAgo' : 'daysAgo'}`, { value: ageValue })
    : null;

  const handleRefreshClick = () => {
    if (refreshing) return;
    setRefreshing(true);
    useNewsStore.getState().refresh(addToast);
    setTimeout(() => setRefreshing(false), 1500);
  };

  const handleShareClick = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      addToast(t('share.linkCopied', 'Link copied to clipboard'), 'info');
    } catch {
      addToast(t('share.copyFailed', 'Failed to copy link'), 'error');
    }
  };

  /* ── theme observer (sync with data-theme attribute) ── */
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const observer = new MutationObserver(() => {
      setAppTheme(document.documentElement.getAttribute('data-theme') || 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const handleToggleTheme = () => {
    const next = toggleAppTheme();
    setAppTheme(next);
  };

  const handleSignOut = () => {
    db.auth.signOut();
    // Clear any user-specific UI state (saved views are user-scoped)
    const state = useUIStore.getState();
    if (state.savedViews?.length > 0) {
      state.savedViews.forEach((v) => state.deleteView(v));
    }
    setMenuOpen(false);
  };

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
    <header className="app-header" role="banner" data-mobile={isMobile || undefined}>
      <div className="header-brand">
        <BrandMark />
        <span className="brand-title">MAPR</span>
        {!isMobile && <span className="brand-build">v4.12 · OSINT</span>}
      </div>

      {(!isMobile && !isTablet) && (
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
      )}

      {isTablet && (
        <div className="header-search header-search-tablet">
          <Search size={14} color="var(--ink-2)" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="QUERY"
            aria-label={t('nav.ariaLabel')}
          />
        </div>
      )}

      {isMap && !isMobile && !isTablet && (
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
        {!isMobile && !authLoading && (
          user ? (
            <div className="header-user-menu">
              <span className="header-user-email" title={user.email}>
                {user.email}
              </span>
              <button
                type="button"
                className="header-signout-btn"
                onClick={handleSignOut}
                aria-label={t('auth.signOut')}
                title={t('auth.signOut')}
              >
                <LogOut size={12} />
                {t('auth.signOut')}
              </button>
            </div>
          ) : (
            <Link
              to={`/login?returnUrl=${encodeURIComponent(location.pathname + location.search)}`}
              className="header-signin-link"
              aria-label={t('auth.signIn')}
            >
              <LogIn size={12} />
              {t('auth.signIn')}
            </Link>
          )
        )}
        {!isMobile && (
          <>
            <div className="header-refresh-wrap">
              <button
                type="button"
                className={`header-refresh-btn ${refreshing ? 'is-spinning' : ''}`}
                onClick={handleRefreshClick}
                disabled={refreshing}
                title={freshnessTooltip || t('header.refreshLabel')}
                aria-label={t('header.refreshLabel')}
              >
                <RefreshCw size={14} aria-hidden />
              </button>
              {freshnessTooltip && (
                <div className={`header-refresh-tooltip freshness-${ageColor}`}>
                  <span className="freshness-dot" />
                  {freshnessTooltip}
                </div>
              )}
            </div>
            <button
              type="button"
              className="header-share-btn"
              onClick={handleShareClick}
              title={t('share.shareButton', 'Share view')}
              aria-label={t('share.shareButton', 'Share view')}
            >
              <Share2 size={14} aria-hidden />
            </button>
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={handleToggleTheme}
              title={appTheme === 'light' ? t('theme.switchDark') : t('theme.switchLight')}
              aria-label={appTheme === 'light' ? t('theme.switchDark') : t('theme.switchLight')}
            >
              {appTheme === 'light' ? <Moon size={14} aria-hidden /> : <Sun size={14} aria-hidden />}
            </button>
            <button
              type="button"
              className="lang-select"
              onClick={cycleLang}
              title="Cycle language"
              aria-label="Cycle language"
            >
              LANG · <b>{i18n.language.toUpperCase()}</b>
            </button>
          </>
        )}
        <div className="op-badge" aria-live="polite">
          <span
            className="op-dot"
            style={{
              background: opsOk ? 'var(--sev-green)' : 'var(--sev-red)',
              boxShadow: `0 0 6px ${opsOk ? 'var(--sev-green)' : 'var(--sev-red)'}`,
            }}
          />
          {isMobile ? 'OPS' : `OPS · ${opsOk ? 'NOMINAL' : 'DEGRADED'}`}
        </div>
        {isMobile && (
          <>
            <button
              type="button"
              className="header-icon-btn"
              aria-label="Search"
              onClick={() => setSearchOpen((v) => !v)}
            >
              <Search size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="header-icon-btn"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
            </button>
          </>
        )}
      </div>

      {isMobile && menuOpen && (
        <div className="header-mobile-menu" role="menu">
          {!authLoading && (
            user ? (
              <div className="header-mobile-auth">
                <span className="header-user-email" title={user.email}>
                  {user.email}
                </span>
                <button
                  type="button"
                  className="header-signout-btn"
                  onClick={handleSignOut}
                  role="menuitem"
                >
                  <LogOut size={12} />
                  {t('auth.signOut')}
                </button>
              </div>
            ) : (
              <Link
                to={`/login?returnUrl=${encodeURIComponent(location.pathname + location.search)}`}
                className="header-signin-link"
                onClick={() => setMenuOpen(false)}
                role="menuitem"
              >
                <LogIn size={12} />
                {t('auth.signIn')}
              </Link>
            )
          )}
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={() => { handleToggleTheme(); setMenuOpen(false); }}
            role="menuitem"
          >
            {appTheme === 'light' ? <Moon size={14} aria-hidden /> : <Sun size={14} aria-hidden />}
            {' '}{appTheme === 'light' ? t('theme.dark') : t('theme.light')}
          </button>
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={() => { handleShareClick(); setMenuOpen(false); }}
            role="menuitem"
          >
            <Share2 size={14} aria-hidden />
            {' '}{t('share.shareButton', 'Share')}
          </button>
          <button
            type="button"
            className="lang-select"
            onClick={() => { cycleLang(); setMenuOpen(false); }}
          >
            LANG · <b>{i18n.language.toUpperCase()}</b>
          </button>
        </div>
      )}

      {isMobile && searchOpen && (
        <div className="header-mobile-search">
          <Search size={15} color="var(--ink-2)" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="QUERY"
            aria-label={t('nav.ariaLabel')}
            autoFocus
          />
          <button
            type="button"
            className="header-icon-btn"
            aria-label="Close search"
            onClick={() => setSearchOpen(false)}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      )}
    </header>
  );
}
