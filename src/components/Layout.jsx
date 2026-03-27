import React, { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Globe, Map, Shield, Network, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * App-wide layout shell with a collapsible navigation sidebar.
 * Wraps all routes and renders their content via <Outlet />.
 */
export default function Layout() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className={`layout ${collapsed ? 'layout--collapsed' : ''}`}>
      <nav className="layout-nav" aria-label={t('nav.ariaLabel')}>
        <div className="layout-nav-links">
          <NavLink to="/" end className="layout-nav-link" title={t('nav.map')}>
            <Globe size={18} />
            {!collapsed && <span>{t('nav.map')}</span>}
          </NavLink>
          <NavLink to="/admin" className="layout-nav-link" title={t('nav.admin')}>
            <Shield size={18} />
            {!collapsed && <span>{t('nav.admin')}</span>}
          </NavLink>
          <NavLink to="/entities" className="layout-nav-link" title={t('nav.entities')}>
            <Network size={18} />
            {!collapsed && <span>{t('nav.entities')}</span>}
          </NavLink>
        </div>
        <button
          className="layout-nav-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </nav>
      <main className="layout-content">
        <Outlet />
      </main>
    </div>
  );
}
