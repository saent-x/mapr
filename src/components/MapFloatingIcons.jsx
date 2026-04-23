import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, Layers, Globe as GlobeIcon, Activity } from 'lucide-react';
import useBreakpoint from '../hooks/useBreakpoint';
import useFilterStore from '../stores/filterStore';
import useUIStore from '../stores/uiStore';
import { COVERAGE_STATUS_ORDER, getCoverageMeta } from '../utils/coverageMeta';

const SEV_TIERS = [
  { key: 'black', min: 85, label: 'BLACK' },
  { key: 'red', min: 70, label: 'RED' },
  { key: 'amber', min: 40, label: 'AMBER' },
  { key: 'green', min: 0, label: 'GREEN' },
];

const GEO_LEGEND = [
  { key: 'low', color: 'rgba(0, 212, 255, 0.8)', labelKey: 'legend.geoLow' },
  { key: 'medium', color: 'rgba(255, 170, 0, 0.8)', labelKey: 'legend.geoMedium' },
  { key: 'high', color: 'rgba(255, 85, 85, 0.8)', labelKey: 'legend.geoHigh' },
];

function IconButton({ id, icon: Icon, label, active, onClick }) {
  return (
    <button
      type="button"
      className="map-fab"
      data-active={active || undefined}
      aria-pressed={active}
      aria-label={label}
      aria-haspopup={id === 'intel' ? 'dialog' : 'true'}
      aria-expanded={active}
      onClick={onClick}
      data-fab-id={id}
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}

function Popover({ id, title, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const first = ref.current?.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="map-fab-popover"
      role="dialog"
      aria-modal="false"
      aria-label={title}
      data-fab-popover={id}
    >
      <div className="map-fab-popover-title">{title}</div>
      <div className="map-fab-popover-body">{children}</div>
    </div>
  );
}

export default function MapFloatingIcons() {
  const { t } = useTranslation();
  const { isMobile, isTablet } = useBreakpoint();

  const mapOverlay = useFilterStore((s) => s.mapOverlay);
  const setMapOverlay = useFilterStore((s) => s.setMapOverlay);
  const minSeverity = useFilterStore((s) => s.minSeverity);
  const setMinSeverity = useFilterStore((s) => s.setMinSeverity);

  const drawerMode = useUIStore((s) => s.drawerMode);
  const setDrawerMode = useUIStore((s) => s.setDrawerMode);

  const [openPopover, setOpenPopover] = useState(null);
  const containerRef = useRef(null);

  const closePopover = useCallback(() => setOpenPopover(null), []);

  useEffect(() => {
    if (!openPopover) return undefined;
    const onDown = (e) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target)) closePopover();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [openPopover, closePopover]);

  if (!isMobile && !isTablet) return null;

  const handleIconTap = (id) => {
    if (id === 'intel') {
      setDrawerMode(drawerMode === 'intel-mobile' ? null : 'intel-mobile');
      setOpenPopover(null);
      return;
    }
    setOpenPopover((cur) => (cur === id ? null : id));
  };

  const toggleOverlay = (key) => {
    setMapOverlay(mapOverlay === key ? null : key);
    setOpenPopover(null);
  };

  return (
    <div
      ref={containerRef}
      className="map-fab-stack"
      role="group"
      aria-label="Map overlay shortcuts"
    >
      <div className="map-fab-col">
        <IconButton
          id="severity"
          icon={Gauge}
          label="Severity overlay"
          active={openPopover === 'severity'}
          onClick={() => handleIconTap('severity')}
        />
        <IconButton
          id="coverage"
          icon={Layers}
          label="Coverage overlay"
          active={openPopover === 'coverage'}
          onClick={() => handleIconTap('coverage')}
        />
        <IconButton
          id="geo"
          icon={GlobeIcon}
          label="Geopolitical overlay"
          active={openPopover === 'geo'}
          onClick={() => handleIconTap('geo')}
        />
        <IconButton
          id="intel"
          icon={Activity}
          label="Intel"
          active={drawerMode === 'intel-mobile'}
          onClick={() => handleIconTap('intel')}
        />
      </div>

      {openPopover === 'severity' && (
        <Popover id="severity" title={t('legend.severity')} onClose={closePopover}>
          <button
            type="button"
            className="chip map-fab-overlay-toggle"
            data-active={mapOverlay === 'severity'}
            aria-pressed={mapOverlay === 'severity'}
            onClick={() => toggleOverlay('severity')}
          >
            SEV · {mapOverlay === 'severity' ? 'ON' : 'OFF'}
          </button>
          <div className="map-fab-section-label">Minimum tier</div>
          <div className="chip-row map-fab-chip-row">
            {SEV_TIERS.map(({ key, min, label }) => (
              <button
                key={key}
                type="button"
                className="chip"
                data-active={minSeverity === min}
                aria-pressed={minSeverity === min}
                aria-label={`Minimum severity ${label}`}
                onClick={() => {
                  setMinSeverity(minSeverity === min ? 0 : min);
                  setOpenPopover(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </Popover>
      )}

      {openPopover === 'coverage' && (
        <Popover id="coverage" title={t('legend.coverage')} onClose={closePopover}>
          <button
            type="button"
            className="chip map-fab-overlay-toggle"
            data-active={mapOverlay === 'coverage'}
            aria-pressed={mapOverlay === 'coverage'}
            onClick={() => toggleOverlay('coverage')}
          >
            COV · {mapOverlay === 'coverage' ? 'ON' : 'OFF'}
          </button>
          <div className="map-fab-section-label">Legend</div>
          <div className="map-fab-legend">
            {COVERAGE_STATUS_ORDER.map((status) => {
              const meta = getCoverageMeta(status);
              return (
                <span key={status} className="legend-item">
                  <span className="legend-dot" style={{ background: meta.accent }} />
                  {t(`coverageStatus.${meta.labelKey}`)}
                </span>
              );
            })}
          </div>
        </Popover>
      )}

      {openPopover === 'geo' && (
        <Popover id="geo" title={t('legend.geopolitical')} onClose={closePopover}>
          <button
            type="button"
            className="chip map-fab-overlay-toggle"
            data-active={mapOverlay === 'geopolitical'}
            aria-pressed={mapOverlay === 'geopolitical'}
            onClick={() => toggleOverlay('geopolitical')}
          >
            GEO · {mapOverlay === 'geopolitical' ? 'ON' : 'OFF'}
          </button>
          <div className="map-fab-section-label">Legend</div>
          <div className="map-fab-legend">
            {GEO_LEGEND.map(({ key, color, labelKey }) => (
              <span key={key} className="legend-item">
                <span className="legend-dot" style={{ background: color }} />
                {t(labelKey)}
              </span>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
