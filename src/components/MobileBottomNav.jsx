import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Map as MapIcon, Activity, SlidersHorizontal } from 'lucide-react';
import useBreakpoint from '../hooks/useBreakpoint';

export default function MobileBottomNav() {
  const { isMobile } = useBreakpoint();
  const loc = useLocation();
  if (!isMobile) return null;
  const path = loc.pathname;
  return (
    <nav className="mobile-bottom-nav" role="navigation" aria-label="Mobile navigation">
      <Link to="/" className="bottom-nav-btn" data-active={path === '/' || undefined} aria-label="Map">
        <MapIcon size={20} aria-hidden />
        <span>MAP</span>
      </Link>
      <Link to="/intel" className="bottom-nav-btn" data-active={path === '/intel' || undefined} aria-label="Intel">
        <Activity size={20} aria-hidden />
        <span>INTEL</span>
      </Link>
      <Link to="/filters" className="bottom-nav-btn" data-active={path === '/filters' || undefined} aria-label="Filters">
        <SlidersHorizontal size={20} aria-hidden />
        <span>FILTERS</span>
      </Link>
    </nav>
  );
}
