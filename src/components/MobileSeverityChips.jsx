import React, { useMemo } from 'react';
import useBreakpoint from '../hooks/useBreakpoint';
import useFilterStore from '../stores/filterStore';

const TIERS = [
  { key: 'black', min: 85, label: 'BLACK' },
  { key: 'red', min: 70, label: 'RED' },
  { key: 'amber', min: 40, label: 'AMBER' },
  { key: 'green', min: 0, label: 'GREEN' },
];

export default function MobileSeverityChips({ allNews = [] }) {
  const { isMobile, isTablet } = useBreakpoint();
  const minSeverity = useFilterStore((s) => s.minSeverity);
  const setMinSeverity = useFilterStore((s) => s.setMinSeverity);

  const counts = useMemo(() => ({
    black: allNews.filter((e) => (e.severity ?? 0) >= 85).length,
    red: allNews.filter((e) => (e.severity ?? 0) >= 70 && (e.severity ?? 0) < 85).length,
    amber: allNews.filter((e) => (e.severity ?? 0) >= 40 && (e.severity ?? 0) < 70).length,
    green: allNews.filter((e) => (e.severity ?? 0) < 40).length,
  }), [allNews]);

  if (!isMobile && !isTablet) return null;

  return (
    <div
      className="mobile-severity-chips"
      role="group"
      aria-label="Severity filter"
    >
      {TIERS.map(({ key, min, label }) => {
        const active = minSeverity === min;
        return (
          <button
            key={key}
            type="button"
            className="mobile-severity-chip"
            data-sev={key}
            data-active={active || undefined}
            aria-pressed={active}
            aria-label={`Minimum severity ${label}${active ? ' — active' : ''}`}
            onClick={() => setMinSeverity(active ? 0 : min)}
          >
            <span>{label}</span>
            <span className="ct">{counts[key]}</span>
          </button>
        );
      })}
    </div>
  );
}
