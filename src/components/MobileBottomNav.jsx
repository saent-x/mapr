import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Map as MapIcon, Activity, SlidersHorizontal } from 'lucide-react';
import useBreakpoint from '../hooks/useBreakpoint';
import useUIStore from '../stores/uiStore';

export default function MobileBottomNav() {
  const { isMobile } = useBreakpoint();
  const loc = useLocation();
  const drawerMode = useUIStore((s) => s.drawerMode);
  const setDrawerMode = useUIStore((s) => s.setDrawerMode);
  if (!isMobile) return null;
  const isMap = loc.pathname === '/';
  return (
    <nav className="mobile-bottom-nav" role="navigation" aria-label="Mobile navigation">
      <Link to="/" className="bottom-nav-btn" data-active={isMap || undefined} aria-label="Map">
        <MapIcon size={20} aria-hidden />
        <span>MAP</span>
      </Link>
      <button
        type="button"
        className="bottom-nav-btn"
        data-active={drawerMode === 'intel-mobile' || undefined}
        onClick={() => setDrawerMode(drawerMode === 'intel-mobile' ? null : 'intel-mobile')}
        aria-label="Intel"
        aria-pressed={drawerMode === 'intel-mobile'}
      >
        <Activity size={20} aria-hidden />
        <span>INTEL</span>
      </button>
      <button
        type="button"
        className="bottom-nav-btn"
        data-active={drawerMode === 'filters' || undefined}
        onClick={() => setDrawerMode(drawerMode === 'filters' ? null : 'filters')}
        aria-label="Filters"
        aria-pressed={drawerMode === 'filters'}
      >
        <SlidersHorizontal size={20} aria-hidden />
        <span>FILTERS</span>
      </button>
    </nav>
  );
}
