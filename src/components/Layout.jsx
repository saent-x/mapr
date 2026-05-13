import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Network, TrendingUp, MapPin } from 'lucide-react';
import BrandMark from './BrandMark';
import Header from './Header';
import MobileBottomNav from './MobileBottomNav';
import OfflineBanner from './OfflineBanner';
import ShortcutHelp from './ShortcutHelp';
import OnboardingOverlay from './OnboardingOverlay';
import AgentSidebar from './AgentSidebar';
import SavedViewsSidebar from './SavedViewsSidebar';
import AlertRulesPanel from './AlertRulesPanel';
import BookmarksPanel from './BookmarksPanel';
import ErrorBoundary from './ErrorBoundary';
import useNewsStore from '../stores/newsStore';
import useUIStore from '../stores/uiStore';
import useSubscriptionStore from '../stores/subscriptionStore';
import useDataFreshness from '../hooks/useDataFreshness';
import useAuth from '../hooks/useAuth';

let _layoutAutoRefreshActive = false;

function formatClock(d) {
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function StatusBar() {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  const liveNews = useNewsStore((s) => s.liveNews) || [];
  const dataSource = useNewsStore((s) => s.dataSource);
  const sourceHealth = useNewsStore((s) => s.sourceHealth);
  const opsHealth = useNewsStore((s) => s.opsHealth);
  const { ageValue, ageUnit, ageColor } = useDataFreshness();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const freshnessText = ageValue != null && ageUnit
    ? t(`freshness.${ageUnit === 's' ? 'secondsAgo' : ageUnit === 'm' ? 'minutesAgo' : ageUnit === 'h' ? 'hoursAgo' : 'daysAgo'}`, { value: ageValue })
    : null;

  const red = liveNews.filter((e) => (e.severity ?? 0) >= 70).length;
  const amber = liveNews.filter((e) => {
    const s = e.severity ?? 0;
    return s >= 40 && s < 70;
  }).length;
  const green = liveNews.filter((e) => (e.severity ?? 0) < 40).length;

  const sources = sourceHealth?.sources || {};
  const totalSources = Object.keys(sources).length || 312;
  const degraded = Object.values(sources).filter((x) => x?.status && x.status !== 'ok').length;

  const feedStatusLabel = dataSource === 'live'
    ? 'LIVE'
    : dataSource === 'loading'
      ? 'LOADING'
      : 'OFFLINE';

  const opsLabel = dataSource === 'unavailable'
    ? 'OFFLINE'
    : dataSource === 'loading'
      ? 'LOADING'
      : opsHealth?.status
        ? opsHealth.status.toUpperCase()
        : 'NOMINAL';

  const freshnessColorVar = ageColor === 'green'
    ? 'var(--sev-green)'
    : ageColor === 'amber'
      ? 'var(--sev-amber)'
      : 'var(--sev-red)';

  return (
    <div className="app-status" role="status" aria-live="polite">
      <div className="status-item">● <b className="tnum">{formatClock(now)}</b></div>
      <div className="status-sep" />
      {freshnessText && (
        <>
          <div
            className="status-item status-freshness"
            style={{ color: freshnessColorVar }}
          >
            {freshnessText}
          </div>
          <div className="status-sep" />
        </>
      )}
      <div className="status-item">FEED · <b>{feedStatusLabel}</b> · <span className="tnum">{liveNews.length}</span> evt</div>
      <div className="status-item">RED <b className="tnum" style={{ color: 'var(--sev-red)' }}>{red}</b></div>
      <div className="status-item">AMBER <b className="tnum" style={{ color: 'var(--sev-amber)' }}>{amber}</b></div>
      <div className="status-item">GREEN <b className="tnum" style={{ color: 'var(--sev-green)' }}>{green}</b></div>
      <div className="status-sep" />
      <div className="status-item">
        SRC · <b className="tnum">{totalSources}</b> online
        {degraded > 0 && <> · <b className="tnum" style={{ color: 'var(--sev-amber)' }}>{degraded}</b> degraded</>}
      </div>
      <div className="status-right">
        <div className="status-item">LANG · <b>{i18n.language.toUpperCase()}</b></div>
        <div className="status-item">OP · <b>{opsLabel}</b></div>
        <div className="status-item">{t('nav.ariaLabel')}</div>
      </div>
    </div>
  );
}

/**
 * App shell — header + sidebar + main (Outlet) + status bar.
 * Shared across all routes.
 */
export default function Layout() {
  const { t } = useTranslation();
  const location = useLocation();
  const lastRegionIso = useUIStore((s) => s.lastRegionIso);
  const addToast = useUIStore((s) => s.addToast);
  const regionTarget = lastRegionIso ? `/region/${lastRegionIso}` : '/region';
  const { user } = useAuth();
  const initFromUser = useSubscriptionStore((s) => s.initFromUser);
  const loadFeatureFlags = useSubscriptionStore((s) => s.loadFeatureFlags);

  // Initialize subscription status from InstantDB when auth state changes
  useEffect(() => {
    initFromUser(user);
  }, [user, initFromUser]);

  useEffect(() => {
    loadFeatureFlags();
  }, [loadFeatureFlags]);

  useEffect(() => {
    if (_layoutAutoRefreshActive) return undefined;
    _layoutAutoRefreshActive = true;
    useNewsStore.getState().startAutoRefresh(addToast);
    useNewsStore.getState().loadSnapshotHistory();
    return () => {
      _layoutAutoRefreshActive = false;
      useNewsStore.getState().stopAutoRefresh();
    };
  }, [addToast]);

  return (
    <div className="layout">
      <Header />
      <OfflineBanner />

      <aside className="app-sidebar" aria-label={t('nav.ariaLabel')}>
        <nav className="layout-nav-links">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `layout-nav-link${isActive ? ' active' : ''}`}
            title={t('nav.map')}
          >
            <BrandMark className="layout-mapr-nav-icon" size={18} />
            <span className="side-label">{t('nav.map')}</span>
          </NavLink>
          <NavLink
            to="/entities"
            className={({ isActive }) => `layout-nav-link${isActive ? ' active' : ''}`}
            title={t('nav.entities')}
          >
            <Network size={18} aria-hidden />
            <span className="side-label">{t('nav.entities')}</span>
          </NavLink>
          <NavLink
            to={regionTarget}
            end={false}
            className={({ isActive }) => `layout-nav-link${isActive ? ' active' : ''}`}
            title={t('nav.region', 'Region') + (lastRegionIso ? ` · ${lastRegionIso}` : '')}
          >
            <MapPin size={18} aria-hidden />
            <span className="side-label">
              {t('nav.region', 'Region')}
              {lastRegionIso && <span className="side-label-sub"> · {lastRegionIso}</span>}
            </span>
          </NavLink>
          <NavLink
            to="/trends"
            className={({ isActive }) => `layout-nav-link${isActive ? ' active' : ''}`}
            title={t('nav.trends')}
          >
            <TrendingUp size={18} aria-hidden />
            <span className="side-label">{t('nav.trends')}</span>
          </NavLink>
        </nav>

        <SavedViewsSidebar />
        <AlertRulesPanel />
        <BookmarksPanel />
      </aside>

      <main className="layout-content app-main" data-route={location.pathname}>
        {/* Per-route ErrorBoundary so a crash inside one page doesn't blank
            the whole app shell (sidebar, header, status bar stay rendered). */}
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      <StatusBar />
      <MobileBottomNav />
      <ShortcutHelp />
      <AgentSidebar />
      {location.pathname === '/' && <OnboardingOverlay />}
    </div>
  );
}
