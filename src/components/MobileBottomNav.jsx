import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Map as MapIcon,
  Network,
  MapPin,
  TrendingUp,
  Activity,
} from 'lucide-react';
import useBreakpoint from '../hooks/useBreakpoint';
import useUIStore from '../stores/uiStore';

export default function MobileBottomNav() {
  const { t } = useTranslation();
  const { isMobile } = useBreakpoint();
  const loc = useLocation();
  const lastRegionIso = useUIStore((s) => s.lastRegionIso);
  if (!isMobile) return null;

  const path = loc.pathname;
  const regionTarget = lastRegionIso ? `/region/${lastRegionIso}` : '/region';

  const tabs = [
    { to: '/', label: t('nav.map', 'Map'), icon: MapIcon, active: path === '/' },
    { to: '/entities', label: t('nav.entities', 'Entities'), icon: Network, active: path.startsWith('/entities') },
    { to: regionTarget, label: t('nav.region', 'Region'), icon: MapPin, active: path.startsWith('/region') },
    { to: '/trends', label: t('nav.trends', 'Trends'), icon: TrendingUp, active: path.startsWith('/trends') },
    { to: '/intel', label: t('nav.intel', 'Intel'), icon: Activity, active: path.startsWith('/intel') },
  ];

  return (
    <nav className="mobile-bottom-nav" role="navigation" aria-label="Mobile navigation">
      {tabs.map(({ to, label, icon: Icon, active }) => (
        <Link
          key={to}
          to={to}
          className="bottom-nav-btn"
          data-active={active || undefined}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
        >
          <Icon size={18} aria-hidden />
          <span>{label.toUpperCase()}</span>
        </Link>
      ))}
    </nav>
  );
}
