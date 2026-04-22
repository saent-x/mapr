import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Header from './Header';
import useNewsStore from '../stores/newsStore';

const Ico = {
  map: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z"/><path d="M9 3v15M15 6v15"/>
    </svg>
  ),
  entities: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/>
      <circle cx="12" cy="11" r="2"/><path d="M7.5 7l3 3M16.5 7l-3 3M12 13v3"/>
    </svg>
  ),
  trends: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M3 17l5-5 4 4 9-9"/><path d="M14 7h7v7"/>
    </svg>
  ),
};

function formatClock(d) {
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function StatusBar() {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  const liveNews = useNewsStore((s) => s.liveNews) || [];
  const sourceHealth = useNewsStore((s) => s.sourceHealth);
  const opsHealth = useNewsStore((s) => s.opsHealth);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const red = liveNews.filter((e) => (e.severity ?? 0) >= 70).length;
  const amber = liveNews.filter((e) => {
    const s = e.severity ?? 0;
    return s >= 40 && s < 70;
  }).length;
  const green = liveNews.filter((e) => (e.severity ?? 0) < 40).length;

  const sources = sourceHealth?.sources || {};
  const totalSources = Object.keys(sources).length || 312;
  const degraded = Object.values(sources).filter((x) => x?.status && x.status !== 'ok').length;

  const opsLabel = opsHealth?.status
    ? opsHealth.status.toUpperCase()
    : 'NOMINAL';

  return (
    <div className="app-status" role="status" aria-live="polite">
      <div className="status-item">● <b>{formatClock(now)}</b></div>
      <div className="status-sep" />
      <div className="status-item">FEED · <b>{liveNews.length}</b> evt</div>
      <div className="status-item">RED <b style={{ color: 'var(--sev-red)' }}>{red}</b></div>
      <div className="status-item">AMBER <b style={{ color: 'var(--sev-amber)' }}>{amber}</b></div>
      <div className="status-item">GREEN <b style={{ color: 'var(--sev-green)' }}>{green}</b></div>
      <div className="status-sep" />
      <div className="status-item">
        SRC · <b>{totalSources}</b> online
        {degraded > 0 && <> · <b style={{ color: 'var(--sev-amber)' }}>{degraded}</b> degraded</>}
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

  return (
    <div className="layout">
      <Header />

      <aside className="app-sidebar" aria-label={t('nav.ariaLabel')}>
        <nav className="layout-nav-links">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `layout-nav-link${isActive ? ' active' : ''}`}
            title={t('nav.map')}
          >
            {Ico.map}
            <span className="side-label">{t('nav.map')}</span>
          </NavLink>
          <NavLink
            to="/entities"
            className={({ isActive }) => `layout-nav-link${isActive ? ' active' : ''}`}
            title={t('nav.entities')}
          >
            {Ico.entities}
            <span className="side-label">{t('nav.entities')}</span>
          </NavLink>
          <NavLink
            to="/trends"
            className={({ isActive }) => `layout-nav-link${isActive ? ' active' : ''}`}
            title={t('nav.trends')}
          >
            {Ico.trends}
            <span className="side-label">{t('nav.trends')}</span>
          </NavLink>
        </nav>
      </aside>

      <main className="layout-content app-main" data-route={location.pathname}>
        <Outlet />
      </main>

      <StatusBar />
    </div>
  );
}
