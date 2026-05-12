import { useCallback, useEffect, useRef, useState } from 'react';
import { useMap, MapPopup } from '@/components/ui/map';
import { getSeverityMeta } from '../utils/mockData';
import { getCoverageMeta } from '../utils/coverageMeta';
import { severityToColor } from './MapConstants';
import MapCountries from './MapCountries';
import MapVelocity from './MapVelocity';
import MapArcs from './MapArcs';
import MapArticles from './MapArticles';
import MapTracking from './MapTracking';

/* ──────────────────────────── orchestrator ──────────────────────────── */

const MapGLOverlay = ({
  newsList,
  regionSeverities,
  mapOverlay,
  coverageStatusByIso = {},
  perCountryReliability = {},
  velocitySpikes = [],
  trackingPoints = [],
  selectedRegion,
  selectedStory,
  onRegionSelect,
  onStorySelect,
  onArcSelect,
  onCoverageCountryClick,
  surface = 'flat',
  drillIsos = null,
}) => {
  const { map, isLoaded } = useMap();
  const hoveredIsoRef = useRef(null);
  const [hoveredArcId, setHoveredArcId] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [popupInfo, setPopupInfo] = useState(null);
  const [theme, setTheme] = useState(() =>
    (typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null) || 'dark',
  );

  const isLight = theme === 'light';

  /* ── theme observer ── */
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme') || 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  /* ──────────────────────────── event handlers ──────────────────────────── */

  const latestHandlers = useRef({ onStorySelect, onRegionSelect, onArcSelect, onCoverageCountryClick });
  latestHandlers.current = { onStorySelect, onRegionSelect, onArcSelect, onCoverageCountryClick };

  const latestData = useRef({ newsList, trackingPoints, regionSeverities, coverageStatusByIso });
  latestData.current = { newsList, trackingPoints, regionSeverities, coverageStatusByIso };

  const latestOverlay = useRef(mapOverlay);
  latestOverlay.current = mapOverlay;

  useEffect(() => {
    if (!isLoaded || !map) return undefined;

    const handleMouseMove = (e) => {
      // Arc hover first
      let arcFeats = [];
      try {
        arcFeats = map.queryRenderedFeatures(e.point, { layers: ['arc-lines', 'arc-glow'] });
      } catch { arcFeats = []; }
      const arcId = arcFeats.length > 0
        ? `${arcFeats[0].properties.startIso}-${arcFeats[0].properties.endIso}`
        : null;
      setHoveredArcId((prev) => prev !== arcId ? arcId : prev);

      if (arcId) {
        map.getCanvas().style.cursor = 'pointer';
        setHoverInfo(null);
        if (hoveredIsoRef.current) {
          try {
            map.setFeatureState({ source: 'countries', id: hoveredIsoRef.current }, { hover: false });
          } catch { /* ignore */ }
          hoveredIsoRef.current = null;
        }
        return;
      }

      let features = [];
      try {
        features = map.queryRenderedFeatures(e.point, { layers: ['country-fill'] });
      } catch { features = []; }
      const iso = features?.[0]?.properties?._iso || null;
      const name = features?.[0]?.properties?.NAME || features?.[0]?.properties?.ADMIN || iso;

      if (hoveredIsoRef.current && hoveredIsoRef.current !== iso) {
        try {
          map.setFeatureState(
            { source: 'countries', id: hoveredIsoRef.current },
            { hover: false },
          );
        } catch { /* ignore */ }
      }
      if (iso && iso !== hoveredIsoRef.current) {
        try {
          map.setFeatureState(
            { source: 'countries', id: iso },
            { hover: true },
          );
        } catch { /* ignore */ }
      }
      hoveredIsoRef.current = iso;
      map.getCanvas().style.cursor = iso ? 'pointer' : '';

      if (iso) {
        const rd = latestData.current.regionSeverities[iso];
        const ce = latestData.current.coverageStatusByIso[iso];
        setHoverInfo({ lng: e.lngLat.lng, lat: e.lngLat.lat, name, iso, regionData: rd || null, coverageEntry: ce || null });
      } else {
        setHoverInfo(null);
      }
    };

    const handleMouseLeave = () => {
      if (hoveredIsoRef.current) {
        try {
          map.setFeatureState(
            { source: 'countries', id: hoveredIsoRef.current },
            { hover: false },
          );
        } catch { /* ignore */ }
        hoveredIsoRef.current = null;
      }
      setHoveredArcId(null);
      setHoverInfo(null);
      map.getCanvas().style.cursor = '';
    };

    const handleClick = (e) => {
      // tracking
      let trackFeatures = [];
      try { trackFeatures = map.queryRenderedFeatures(e.point, { layers: ['tracking-icons'] }); } catch { /* ignore */ }
      if (trackFeatures.length > 0) {
        const props = trackFeatures[0].properties;
        const coords = trackFeatures[0].geometry.coordinates.slice();
        const isAir = props.kind === 'air';
        const point = latestData.current.trackingPoints.find((p) => p.id === props.id);
        const details = [];
        if (isAir && point) {
          if (point.altitude != null) details.push(`${Math.round(point.altitude)}m alt`);
          if (point.velocity != null) details.push(`${Math.round(point.velocity)}m/s`);
          if (point.originCountry) details.push(point.originCountry);
        } else if (point) {
          if (point.speed != null) details.push(`${point.speed.toFixed(1)}kn`);
        }
        setPopupInfo({
          lng: coords[0],
          lat: coords[1],
          title: props.label || props.id,
          severity: isAir ? 'Aircraft' : 'Vessel',
          severityAccent: isAir ? '#7ecbff' : '#44ddb0',
          severityMuted: isAir ? 'rgba(126,203,255,0.15)' : 'rgba(68,221,176,0.15)',
          locality: details.join(' · '),
          category: props.emergency || '',
        });
        return;
      }

      let markerFeatures = [];
      try { markerFeatures = map.queryRenderedFeatures(e.point, { layers: ['article-markers'] }); } catch { /* ignore */ }
      if (markerFeatures.length > 0) {
        const props = markerFeatures[0].properties;
        const story = latestData.current.newsList.find((s) => s.id === props.id);
        if (story) {
          latestHandlers.current.onStorySelect?.(story);
          const coords = markerFeatures[0].geometry.coordinates.slice();
          const meta = getSeverityMeta(story.severity);
          setPopupInfo({
            lng: coords[0],
            lat: coords[1],
            title: story.title,
            severity: meta.label,
            severityAccent: meta.accent,
            severityMuted: meta.muted,
            locality: story.locality,
            category: story.category,
          });
          return;
        }
      }

      let clusterFeatures = [];
      try { clusterFeatures = map.queryRenderedFeatures(e.point, { layers: ['cluster-circles'] }); } catch { /* ignore */ }
      if (clusterFeatures.length > 0) {
        const clusterId = clusterFeatures[0].properties.cluster_id;
        const source = map.getSource('articles');
        if (source && source.getClusterExpansionZoom) {
          try {
            const p = source.getClusterExpansionZoom(clusterId);
            if (p && typeof p.then === 'function') {
              p.then((zoom) => {
                map.flyTo({
                  center: clusterFeatures[0].geometry.coordinates,
                  zoom,
                  duration: 600,
                });
              }).catch(() => { /* ignore */ });
            } else {
              source.getClusterExpansionZoom(clusterId, (err, zoom) => {
                if (err) return;
                map.flyTo({
                  center: clusterFeatures[0].geometry.coordinates,
                  zoom,
                  duration: 600,
                });
              });
            }
          } catch { /* ignore */ }
        }
        return;
      }

      let arcFeatures = [];
      try { arcFeatures = map.queryRenderedFeatures(e.point, { layers: ['arc-lines', 'arc-glow'] }); } catch { /* ignore */ }
      if (arcFeatures.length > 0 && latestHandlers.current.onArcSelect) {
        const props = arcFeatures[0].properties;
        latestHandlers.current.onArcSelect({
          startIso: props.startIso,
          endIso: props.endIso,
          startRegion: props.startRegion,
          endRegion: props.endRegion,
          category: props.category,
          severity: props.severity,
          type: props.arcType || 'same-event',
          label: props.arcLabel || null,
        });
        setPopupInfo(null);
        return;
      }

      let countryFeatures = [];
      try { countryFeatures = map.queryRenderedFeatures(e.point, { layers: ['country-fill'] }); } catch { /* ignore */ }
      if (countryFeatures.length > 0) {
        const iso = countryFeatures[0].properties._iso;
        if (iso) {
          if (latestOverlay.current === 'coverage' && latestHandlers.current.onCoverageCountryClick) {
            latestHandlers.current.onCoverageCountryClick(iso);
          } else {
            latestHandlers.current.onRegionSelect?.(iso);
          }
          setPopupInfo(null);
        }
      }
    };

    map.on('mousemove', handleMouseMove);
    map.on('mouseout', handleMouseLeave);
    map.on('click', handleClick);

    return () => {
      map.off('mousemove', handleMouseMove);
      map.off('mouseout', handleMouseLeave);
      map.off('click', handleClick);
    };
  }, [isLoaded, map]);

  /* ── hover arc filter ── */
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer('arc-hover')) return;
    if (hoveredArcId) {
      const [a, b] = hoveredArcId.split('-');
      try {
        map.setFilter('arc-hover', ['all',
          ['==', ['get', 'startIso'], a],
          ['==', ['get', 'endIso'], b],
        ]);
      } catch { /* ignore */ }
    } else {
      try { map.setFilter('arc-hover', ['==', 1, 0]); } catch { /* ignore */ }
    }
  }, [isLoaded, map, hoveredArcId]);

  /* ──────────────────────────── popups ──────────────────────────── */

  const handleClosePopup = useCallback(() => setPopupInfo(null), []);

  return (
    <>
      {/* Sub-component layers */}
      <MapCountries
        regionSeverities={regionSeverities}
        mapOverlay={mapOverlay}
        coverageStatusByIso={coverageStatusByIso}
        perCountryReliability={perCountryReliability}
        selectedRegion={selectedRegion}
        drillIsos={drillIsos}
        isLight={isLight}
      />
      <MapVelocity
        velocitySpikes={velocitySpikes}
        newsList={newsList}
      />
      <MapArcs
        newsList={newsList}
        mapOverlay={mapOverlay}
        hoveredArcId={hoveredArcId}
      />
      <MapArticles
        newsList={newsList}
        selectedStory={selectedStory}
        surface={surface}
        selectedRegion={selectedRegion}
      />
      <MapTracking
        trackingPoints={trackingPoints}
      />

      {/* Hover popup */}
      {hoverInfo && !popupInfo && (
        <MapPopup
          longitude={hoverInfo.lng}
          latitude={hoverInfo.lat}
          anchor="bottom"
          closeOnClick={false}
          closeButton={false}
          className="flatmap-gl-hover"
          maxWidth="200px"
          offset={12}
        >
          <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '10px', lineHeight: '1.5', color: isLight ? '#1a1a1a' : '#e0e0e0' }}>
            <div style={{ fontWeight: 600, fontSize: '11px', marginBottom: '2px' }}>{hoverInfo.name}</div>
            {hoverInfo.regionData ? (() => {
              const hMeta = getSeverityMeta(hoverInfo.regionData.peakSeverity);
              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ opacity: 0.5 }}>Severity</span>
                    <span style={{ color: hMeta.accent, fontWeight: 500 }}>{hMeta.label}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ opacity: 0.5 }}>Reports</span>
                    <span>{hoverInfo.regionData.count}</span>
                  </div>
                </>
              );
            })() : hoverInfo.coverageEntry ? (() => {
              const cMeta = getCoverageMeta(hoverInfo.coverageEntry.status);
              return (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <span style={{ opacity: 0.5 }}>Status</span>
                  <span style={{ color: cMeta.accent }}>{hoverInfo.coverageEntry.status}</span>
                </div>
              );
            })() : (
              <div style={{ opacity: 0.4 }}>No data</div>
            )}
          </div>
        </MapPopup>
      )}

      {/* Click popup */}
      {popupInfo && (
        <MapPopup
          longitude={popupInfo.lng}
          latitude={popupInfo.lat}
          anchor="bottom"
          closeOnClick
          closeButton
          onClose={handleClosePopup}
          className="flatmap-gl-popup"
          maxWidth="260px"
        >
          <div style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '11px',
            lineHeight: '1.4',
            color: isLight ? '#1a1a1a' : '#e0e0e0',
          }}>
            <div style={{
              display: 'inline-block',
              padding: '1px 6px',
              borderRadius: '2px',
              fontSize: '9px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              background: popupInfo.severityMuted,
              color: popupInfo.severityAccent,
              marginBottom: '4px',
            }}>
              {popupInfo.severity}
            </div>
            <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '3px' }}>
              {popupInfo.title}
            </div>
            <div style={{ opacity: 0.6, fontSize: '10px' }}>
              {[popupInfo.locality, popupInfo.category].filter(Boolean).join(' · ')}
            </div>
          </div>
        </MapPopup>
      )}
    </>
  );
};

export default MapGLOverlay;
export { severityToColor };
