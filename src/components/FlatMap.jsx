import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Globe2, Crosshair } from 'lucide-react';
import AppMap from './AppMap';
import MapGLOverlay from './MapGLOverlay';
import { findStateInStory } from '../utils/statesData';
import { isoToCountry } from '../utils/geocoder';

/* ──────────────────────────── constants ──────────────────────────── */

const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
const STORY_ZOOM = isMobile ? 5 : 8;
const REGION_ZOOM = isMobile ? 4 : 6;
const DEFAULT_ZOOM = isMobile ? 1.5 : 2;
const DEFAULT_CENTER = { lng: 10, lat: 20 };

const STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json';
const STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json';

/* ──────────────────────────── macro regions (flat-only drill) ──────────────────────────── */

const MACRO_REGIONS = {
  africa: { label: 'Africa', bounds: [[-20, -35], [55, 38]], isos: new Set(['DZ','AO','BJ','BW','BF','BI','CM','CV','CF','TD','KM','CG','CD','CI','DJ','EG','GQ','ER','SZ','ET','GA','GM','GH','GN','GW','KE','LS','LR','LY','MG','MW','ML','MR','MU','MA','MZ','NA','NE','NG','RW','ST','SN','SC','SL','SO','ZA','SS','SD','TZ','TG','TN','UG','ZM','ZW']) },
  europe: { label: 'Europe', bounds: [[-25, 35], [45, 72]], isos: new Set(['AL','AD','AT','BY','BE','BA','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT','XK','LV','LI','LT','LU','MT','MD','MC','ME','NL','MK','NO','PL','PT','RO','RU','SM','RS','SK','SI','ES','SE','CH','UA','GB']) },
  asia: { label: 'Asia', bounds: [[60, -10], [150, 55]], isos: new Set(['AF','BD','BT','BN','KH','CN','IN','ID','JP','KZ','KG','LA','MY','MV','MN','MM','NP','KP','KR','PK','PH','SG','LK','TW','TJ','TH','TL','TM','UZ','VN']) },
  middleEast: { label: 'Middle East', bounds: [[25, 10], [65, 45]], isos: new Set(['BH','IR','IQ','IL','JO','KW','LB','OM','PS','QA','SA','SY','TR','AE','YE']) },
  northAmerica: { label: 'N. America', bounds: [[-170, 5], [-50, 85]], isos: new Set(['AG','BS','BB','BZ','CA','CR','CU','DM','DO','SV','GD','GT','HT','HN','JM','MX','NI','PA','KN','LC','VC','TT','US']) },
  southAmerica: { label: 'S. America', bounds: [[-85, -60], [-30, 15]], isos: new Set(['AR','BO','BR','CL','CO','EC','GY','PY','PE','SR','UY','VE']) },
  oceania: { label: 'Oceania', bounds: [[100, -50], [180, 5]], isos: new Set(['AU','FJ','KI','MH','FM','NR','NZ','PW','PG','WS','SB','TO','TV','VU']) },
};

/* ──────────────────────────── component ──────────────────────────── */

const FlatMap = ({
  newsList,
  regionSeverities,
  mapOverlay,
  coverageStatusByIso = {},
  velocitySpikes = [],
  trackingPoints = [],
  selectedRegion,
  selectedStory,
  onRegionSelect,
  onStorySelect,
  onArcSelect,
  compact = false,
}) => {
  const { t } = useTranslation();
  const mapRef = useRef(null);
  const [drillRegion, setDrillRegion] = useState(null);
  const [theme, setTheme] = useState(() =>
    (typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null) || 'dark',
  );

  const isLight = theme === 'light';
  const styleUrl = isLight ? STYLE_LIGHT : STYLE_DARK;

  /* ── fly-to tracking refs ── */
  const prevStoryRef = useRef(null);
  const prevRegionRef = useRef(null);
  const hadSelectionRef = useRef(false);

  /* ── theme observer ── */
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme') || 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  /* ── resize handling ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      try { map.resize(); } catch { /* ignore */ }
    });
    const container = map.getContainer?.();
    if (container) observer.observe(container);
    return () => observer.disconnect();
  }, []);

  /* ── fly-to logic ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (selectedStory && selectedStory.id !== prevStoryRef.current) {
      const stateMatch = selectedStory.isoA2
        ? findStateInStory(selectedStory.isoA2, selectedStory)
        : null;

      if (stateMatch) {
        map.flyTo({
          center: [stateMatch.lng, stateMatch.lat],
          zoom: STORY_ZOOM,
          duration: 1200,
        });
      } else {
        map.flyTo({
          center: [selectedStory.coordinates[1], selectedStory.coordinates[0]],
          zoom: REGION_ZOOM,
          duration: 1200,
        });
      }
      prevStoryRef.current = selectedStory.id;
      hadSelectionRef.current = true;
      return;
    }

    if (selectedRegion && selectedRegion !== prevRegionRef.current) {
      const focal =
        regionSeverities[selectedRegion]?.peakStory ||
        newsList.find((s) => s.isoA2 === selectedRegion);
      if (focal?.coordinates) {
        map.flyTo({
          center: [focal.coordinates[1], focal.coordinates[0]],
          zoom: REGION_ZOOM,
          duration: 1200,
        });
        prevRegionRef.current = selectedRegion;
        hadSelectionRef.current = true;
        return;
      }
      // No focal yet — wait for newsList to arrive rather than locking prev.
    }

    if (!selectedStory && !selectedRegion && hadSelectionRef.current) {
      prevStoryRef.current = null;
      prevRegionRef.current = null;
      hadSelectionRef.current = false;
      map.flyTo({
        center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
        zoom: DEFAULT_ZOOM,
        duration: 1200,
      });
    }
  }, [selectedStory, selectedRegion, regionSeverities, newsList]);

  /* ── drill region fly ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drillRegion && MACRO_REGIONS[drillRegion]) {
      const region = MACRO_REGIONS[drillRegion];
      try { map.fitBounds(region.bounds, { padding: 40, duration: 1200 }); } catch { /* ignore */ }
    }
  }, [drillRegion]);

  const regionStoryCounts = useMemo(() => {
    const counts = {};
    for (const key of Object.keys(MACRO_REGIONS)) counts[key] = 0;
    for (const story of newsList) {
      const iso = story.isoA2;
      if (!iso) continue;
      for (const [key, region] of Object.entries(MACRO_REGIONS)) {
        if (region.isos.has(iso)) {
          counts[key]++;
          break;
        }
      }
    }
    return counts;
  }, [newsList]);

  const drillIsos = drillRegion ? MACRO_REGIONS[drillRegion]?.isos : null;

  const handleDrillSelect = useCallback((regionKey) => {
    setDrillRegion(regionKey);
  }, []);

  const handleDrillBack = useCallback(() => {
    setDrillRegion(null);
    const map = mapRef.current;
    if (map) {
      try {
        map.flyTo({
          center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
          zoom: DEFAULT_ZOOM,
          duration: 1200,
        });
      } catch { /* ignore */ }
    }
  }, []);

  const breadcrumb = useMemo(() => {
    const parts = [{ label: 'WORLD', onClick: handleDrillBack }];
    if (drillRegion && MACRO_REGIONS[drillRegion]) {
      parts.push({
        label: MACRO_REGIONS[drillRegion].label.toUpperCase(),
        onClick: () => setDrillRegion(drillRegion),
      });
    }
    if (selectedRegion) {
      const name = isoToCountry(selectedRegion) || selectedRegion;
      parts.push({ label: name.toUpperCase(), onClick: null });
    }
    return parts;
  }, [drillRegion, selectedRegion, handleDrillBack]);

  return (
    <div className="flatmap-wrapper" style={{ position: 'absolute', inset: 0 }}>
      <AppMap
        ref={mapRef}
        surface="flat"
        theme={isLight ? 'light' : 'dark'}
        styleUrl={styleUrl}
        viewport={{
          center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
          zoom: DEFAULT_ZOOM,
        }}
      >
        <MapGLOverlay
          surface="flat"
          newsList={newsList}
          regionSeverities={regionSeverities}
          mapOverlay={mapOverlay}
          coverageStatusByIso={coverageStatusByIso}
          velocitySpikes={velocitySpikes}
          trackingPoints={trackingPoints}
          selectedRegion={selectedRegion}
          selectedStory={selectedStory}
          onRegionSelect={onRegionSelect}
          onStorySelect={onStorySelect}
          onArcSelect={onArcSelect}
          drillIsos={drillIsos}
        />
      </AppMap>

      {/* ── Breadcrumb ── */}
      {!compact && (drillRegion || selectedRegion) && (
        <div style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: isMobile ? '9px' : '10px',
          letterSpacing: '0.08em',
          color: isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)',
          background: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(8px)',
          padding: '4px 8px',
          borderRadius: '3px',
          border: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,200,255,0.1)'}`,
          pointerEvents: 'auto',
        }}>
          {breadcrumb.map((part, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <ChevronRight
                  size={10}
                  style={{ opacity: 0.4, flexShrink: 0 }}
                />
              )}
              {part.onClick ? (
                <span
                  onClick={part.onClick}
                  style={{
                    cursor: 'pointer',
                    color: isLight ? 'rgba(0,0,0,0.7)' : 'rgba(0,200,255,0.7)',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => e.target.style.color = isLight ? '#000' : '#00d4ff'}
                  onMouseLeave={(e) => e.target.style.color = isLight ? 'rgba(0,0,0,0.7)' : 'rgba(0,200,255,0.7)'}
                >
                  {part.label}
                </span>
              ) : (
                <span style={{
                  color: isLight ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.8)',
                  whiteSpace: 'nowrap',
                }}>
                  {part.label}
                </span>
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* ── Region selector (desktop only) ── */}
      {!compact && !isMobile && (
        <div className="map-drill-menu" role="group" aria-label="Continent drill">
          <button
            type="button"
            className={`map-drill-chip${!drillRegion ? ' is-active' : ''}`}
            onClick={handleDrillBack}
            aria-pressed={!drillRegion}
          >
            <Globe2 size={11} aria-hidden />
            <span>{t('map.world', 'WORLD')}</span>
            <span className="map-drill-count">{newsList.length}</span>
          </button>
          {Object.entries(MACRO_REGIONS).map(([key, region]) => {
            const isActive = drillRegion === key;
            const count = regionStoryCounts[key] || 0;
            return (
              <button
                type="button"
                key={key}
                className={`map-drill-chip${isActive ? ' is-active' : ''}`}
                onClick={() => handleDrillSelect(key)}
                aria-pressed={isActive}
              >
                <Crosshair size={9} aria-hidden />
                <span>{region.label.toUpperCase()}</span>
                <span className="map-drill-count">{count > 0 ? count : '—'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FlatMap;
