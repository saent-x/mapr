import React, { useEffect, useRef, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, Menu, X, LogOut, LogIn, Sun, Moon, RefreshCw, Share2, Printer, CreditCard, Settings } from 'lucide-react';
import useFilterStore from '../stores/filterStore';
import useNewsStore from '../stores/newsStore';
import useUIStore from '../stores/uiStore';
import useBreakpoint from '../hooks/useBreakpoint';
import useDataFreshness from '../hooks/useDataFreshness';
import db from '../services/instantDb';
import { toggleTheme as toggleAppTheme } from '../utils/theme';
import BrandMark from './BrandMark';

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
  const printCleanupTimerRef = useRef(null);

  const searchQuery = useFilterStore((s) => s.searchQuery);
  const setSearchQuery = useFilterStore((s) => s.setSearchQuery);
  const mapOverlay = useFilterStore((s) => s.mapOverlay);
  const setMapOverlay = useFilterStore((s) => s.setMapOverlay);

  const opsHealth = useNewsStore((s) => s.opsHealth);
  const backendStatus = useNewsStore((s) => s.sourceHealth?.backend?.status);
  const dataSource = useNewsStore((s) => s.dataSource);
  const status = opsHealth?.status ?? backendStatus ?? 'healthy';
  const isUnavailable = dataSource === 'unavailable';
  const isLoadingData = dataSource === 'loading';
  const opsOk = !isUnavailable && !isLoadingData && (status === 'healthy' || status === 'ok');
  const opsLabel = isUnavailable
    ? 'OFFLINE'
    : isLoadingData
      ? 'LOADING'
      : opsOk
        ? 'NOMINAL'
        : 'DEGRADED';

  const { user, isLoading: authLoading } = db.useAuth();
  const clearSavedViews = useUIStore((s) => s.deleteView);
  const userEmail = user?.email || '';
  const userName = user?.name || user?.displayName || userEmail.split('@')[0] || t('nav.account', 'Account');
  const userInitial = (userName || userEmail || 'M').trim().charAt(0).toUpperCase();

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

  const handlePrintClick = () => {
    if (typeof window === 'undefined') return;
    const cleanup = () => {
      if (printCleanupTimerRef.current) {
        window.clearTimeout(printCleanupTimerRef.current);
        printCleanupTimerRef.current = null;
      }
      document.documentElement.classList.remove('is-preparing-print');
      window.removeEventListener('afterprint', cleanup);
    };
    const printNow = () => {
      try {
        document.body?.getBoundingClientRect();
        window.focus();
        window.print();
        printCleanupTimerRef.current = window.setTimeout(cleanup, 10000);
      } catch (err) {
        cleanup();
        addToast(`${t('print.failed', 'Print could not be opened')}: ${err.message || err}`, 'error');
      }
    };
    document.documentElement.classList.add('is-preparing-print');
    window.addEventListener('afterprint', cleanup, { once: true });
    addToast(t('print.printing', 'Preparing print…'), 'info');
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => window.requestAnimationFrame(printNow));
    } else {
      printCleanupTimerRef.current = window.setTimeout(printNow, 0);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const preparePrint = () => document.documentElement.classList.add('is-preparing-print');
    const finishPrint = () => document.documentElement.classList.remove('is-preparing-print');
    window.addEventListener('beforeprint', preparePrint);
    window.addEventListener('afterprint', finishPrint);
    return () => {
      if (printCleanupTimerRef.current) window.clearTimeout(printCleanupTimerRef.current);
      window.removeEventListener('beforeprint', preparePrint);
      window.removeEventListener('afterprint', finishPrint);
    };
  }, []);

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
        {!isMobile && <span className="brand-build">OSINT</span>}
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
              className="header-print-btn"
              onClick={handlePrintClick}
              title={t('print.printButton', 'Print view')}
              aria-label={t('print.printButton', 'Print view')}
            >
              <Printer size={14} aria-hidden />
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
          {isMobile ? 'OPS' : `OPS · ${opsLabel}`}
        </div>
        {!isMobile && !authLoading && (
          user ? (
            <div className="header-user-menu">
              <button
                type="button"
                className="header-profile-trigger"
                aria-label={t('nav.account', 'Account')}
                title={t('nav.account', 'Account')}
              >
                <span className="header-profile-avatar" aria-hidden>{userInitial}</span>
              </button>
              <div className="header-profile-menu" role="menu">
                <div className="header-profile-meta">
                  <span className="header-profile-name">{userName}</span>
                  <span className="header-profile-email">{userEmail}</span>
                </div>
                <Link to="/account" className="header-profile-item" role="menuitem">
                  <Settings size={13} aria-hidden />
                  {t('nav.account', 'Account')}
                </Link>
                <Link to="/account/billing" className="header-profile-item" role="menuitem">
                  <CreditCard size={13} aria-hidden />
                  {t('subscription.title', 'Billing')}
                </Link>
                <button
                  type="button"
                  className="header-profile-item"
                  onClick={handleSignOut}
                  role="menuitem"
                >
                  <LogOut size={13} />
                  {t('auth.signOut')}
                </button>
              </div>
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
              <span className="header-menu-glyph" data-open={menuOpen || undefined} aria-hidden>
                <span />
                <span />
              </span>
            </button>
          </>
        )}
      </div>

      {isMobile && menuOpen && (
        <div className="header-mobile-menu" role="menu" data-state="open">
          {!authLoading && (
            user ? (
              <div className="header-mobile-auth">
                <Link
                  to="/account"
                  className="header-mobile-account-link"
                  title={t('nav.account', 'Account')}
                  onClick={() => setMenuOpen(false)}
                  role="menuitem"
                >
                  <span className="header-profile-avatar header-profile-avatar-sm" aria-hidden>{userInitial}</span>
                  <span className="header-mobile-account-text">
                    <span>{userName}</span>
                    <small>{userEmail}</small>
                  </span>
                </Link>
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
            className="theme-toggle-btn"
            onClick={() => { handlePrintClick(); setMenuOpen(false); }}
            role="menuitem"
          >
            <Printer size={14} aria-hidden />
            {' '}{t('print.printButton', 'Print')}
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
