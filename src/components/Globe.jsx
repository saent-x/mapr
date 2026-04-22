import { useCallback, useEffect, useRef, useState } from 'react';
import AppMap from './AppMap';
import MapGLOverlay from './MapGLOverlay';

/* ──────────────────────────── constants ──────────────────────────── */

const DEFAULT_VIEW = { lng: 10, lat: 20, zoom: 1.2 };

const isMobile = typeof screen !== 'undefined' && screen.width < 768;
const STORY_ZOOM = isMobile ? 3 : 5;
const REGION_ZOOM = isMobile ? 2.2 : 3;

/* ──────────────────────────── component ──────────────────────────── */

const Globe = ({
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
}) => {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const [userDragged, setUserDragged] = useState(false);
  const autoRotateRef = useRef(null);
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

  /* ── fly-to on selection ── */
  const prevStoryRef = useRef(null);
  const prevRegionRef = useRef(null);
  const hadSelectionRef = useRef(false);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (selectedStory && selectedStory.id !== prevStoryRef.current) {
      try {
        map.flyTo({
          center: [selectedStory.coordinates[1], selectedStory.coordinates[0]],
          zoom: STORY_ZOOM,
          duration: 1200,
        });
      } catch { /* ignore */ }
      prevStoryRef.current = selectedStory.id;
      hadSelectionRef.current = true;
      return;
    }

    if (selectedRegion && selectedRegion !== prevRegionRef.current) {
      const focal =
        regionSeverities[selectedRegion]?.peakStory ||
        newsList.find((s) => s.isoA2 === selectedRegion);
      if (focal) {
        try {
          map.flyTo({
            center: [focal.coordinates[1], focal.coordinates[0]],
            zoom: REGION_ZOOM,
            duration: 1200,
          });
        } catch { /* ignore */ }
      }
      prevRegionRef.current = selectedRegion;
      hadSelectionRef.current = true;
      return;
    }

    if (!selectedStory && !selectedRegion && hadSelectionRef.current) {
      prevStoryRef.current = null;
      prevRegionRef.current = null;
      hadSelectionRef.current = false;
      try {
        map.flyTo({
          center: [DEFAULT_VIEW.lng, DEFAULT_VIEW.lat],
          zoom: DEFAULT_VIEW.zoom,
          duration: 1200,
        });
      } catch { /* ignore */ }
    }
  }, [selectedStory, selectedRegion, regionSeverities, newsList]);

  /* ── user drag / wheel detection (pauses auto-rotate) ── */
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    const dragState = { down: false, moved: false, x: 0, y: 0 };
    const onDown = (e) => {
      dragState.down = true;
      dragState.moved = false;
      dragState.x = e.clientX;
      dragState.y = e.clientY;
    };
    const onMove = (e) => {
      if (!dragState.down) return;
      if (Math.abs(e.clientX - dragState.x) > 5 || Math.abs(e.clientY - dragState.y) > 5) {
        dragState.moved = true;
      }
    };
    const onUp = () => {
      if (dragState.moved) setUserDragged(true);
      dragState.down = false;
      dragState.moved = false;
    };
    const onWheel = () => setUserDragged(true);

    node.addEventListener('pointerdown', onDown);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointerleave', onUp);
    node.addEventListener('wheel', onWheel, { passive: true });

    return () => {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointerleave', onUp);
      node.removeEventListener('wheel', onWheel);
    };
  }, []);

  /* ── auto-rotate loop (paused while selection or user-interacted) ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    const shouldRotate = !selectedStory && !selectedRegion && !userDragged;
    if (!shouldRotate) {
      if (autoRotateRef.current) {
        clearInterval(autoRotateRef.current);
        autoRotateRef.current = null;
      }
      return undefined;
    }

    // Rotate slowly by shifting the center longitude ~0.12° per 100ms (~1.2°/s).
    autoRotateRef.current = setInterval(() => {
      const m = mapRef.current;
      if (!m) return;
      try {
        const center = m.getCenter();
        m.easeTo({
          center: [center.lng + 0.12, center.lat],
          duration: 100,
          easing: (x) => x,
        });
      } catch { /* ignore */ }
    }, 100);

    return () => {
      if (autoRotateRef.current) {
        clearInterval(autoRotateRef.current);
        autoRotateRef.current = null;
      }
    };
  }, [selectedStory, selectedRegion, userDragged]);

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

  const handleMapRef = useCallback((instance) => {
    mapRef.current = instance;
  }, []);

  return (
    <div ref={containerRef} className="globe-wrapper">
      <AppMap
        ref={handleMapRef}
        surface="globe"
        theme={isLight ? 'light' : 'dark'}
        viewport={{
          center: [DEFAULT_VIEW.lng, DEFAULT_VIEW.lat],
          zoom: DEFAULT_VIEW.zoom,
        }}
      >
        <MapGLOverlay
          surface="globe"
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
        />
      </AppMap>
    </div>
  );
};

export default Globe;
