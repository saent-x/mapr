import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppMap from './AppMap';
import MapGLOverlay from './MapGLOverlay';

/* ──────────────────────────── constants ──────────────────────────── */

/**
 * Calibrated "5× larger at rest" default — the current default was `1.2`; a
 * zoom bump of `log2(√5) ≈ 1.16` produces ~5× rendered surface area on-screen.
 * Rounded to `2.5` so the sphere fills more of the stage as the spec requires.
 */
const DEFAULT_ZOOM = 2.5;

/** Starting zoom for the entry animation (matches the old default). */
const ENTRY_START_ZOOM = 1.2;

/** Duration of the initial zoom-in. Spec requires 1.5–2.5s. */
const ENTRY_DURATION_MS = 2000;

const DEFAULT_VIEW = { lng: 10, lat: 20, zoom: DEFAULT_ZOOM };

const MOBILE_QUERY = '(max-width: 767px)';

function getInitialIsMobile() {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(MOBILE_QUERY).matches;
  }
  return window.innerWidth < 768;
}

/** easeInOutCubic — smooth entry. */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

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
  const [mapReady, setMapReady] = useState(false);
  const [userDragged, setUserDragged] = useState(false);
  const autoRotateRef = useRef(null);
  const entryPlayedRef = useRef(false);
  const entryInProgressRef = useRef(false);
  const [theme, setTheme] = useState(() =>
    (typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null) || 'dark',
  );
  const [isMobile, setIsMobile] = useState(getInitialIsMobile);
  const isLight = theme === 'light';

  const { STORY_ZOOM, REGION_ZOOM } = useMemo(() => ({
    STORY_ZOOM: isMobile ? 4 : 5.5,
    REGION_ZOOM: isMobile ? 3 : 4,
  }), [isMobile]);

  /* ── mobile breakpoint observer ── */
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(MOBILE_QUERY);
    const handler = (e) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  /* ── theme observer ── */
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme') || 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  /* ── entry animation (plays once per mount, zoomed-out → new default) ── */
  const handleMapRef = useCallback((instance) => {
    mapRef.current = instance;
    setMapReady(Boolean(instance));
    if (!instance || entryPlayedRef.current) return;

    const playEntry = () => {
      if (entryPlayedRef.current || !mapRef.current) return;
      entryPlayedRef.current = true;
      entryInProgressRef.current = true;
      try {
        // Snap to the small-globe starting pose so the viewer reads the
        // zoom-in as a motion cue on every fresh navigation.
        instance.jumpTo({
          center: [DEFAULT_VIEW.lng, DEFAULT_VIEW.lat],
          zoom: ENTRY_START_ZOOM,
        });
        instance.easeTo({
          center: [DEFAULT_VIEW.lng, DEFAULT_VIEW.lat],
          zoom: DEFAULT_ZOOM,
          duration: ENTRY_DURATION_MS,
          easing: easeInOutCubic,
        });
        // Clear the flag once the animation would have completed; gives
        // auto-rotate / selection flyTos a clean baseline.
        setTimeout(() => { entryInProgressRef.current = false; }, ENTRY_DURATION_MS + 60);
      } catch {
        entryInProgressRef.current = false;
      }
    };

    // Wait for style load so layers render during the animation.
    try {
      if (typeof instance.isStyleLoaded === 'function' && instance.isStyleLoaded()) {
        playEntry();
      } else {
        instance.once('load', playEntry);
      }
    } catch {
      playEntry();
    }
  }, []);

  /* ── fly-to on selection ── */
  const prevStoryRef = useRef(null);
  const prevRegionRef = useRef(null);
  const hadSelectionRef = useRef(false);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Don't steal the camera from the entry animation.
    if (entryInProgressRef.current) return;

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
  }, [selectedStory, selectedRegion, regionSeverities, newsList, STORY_ZOOM, REGION_ZOOM]);

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

  /* ── auto-rotate loop (paused during entry, selection, or user input) ── */
  useEffect(() => {
    if (!mapReady) return undefined;
    const map = mapRef.current;
    if (!map) return undefined;

    const shouldRotate = !selectedStory && !selectedRegion && !userDragged;
    if (!shouldRotate) return undefined;

    // Preserve legacy visual rate (~1.2°/sec = old 0.12°/100ms).
    const DEG_PER_SEC = 1.2;
    let raf = null;
    let last = performance.now();

    const step = (now) => {
      const dt = Math.min(64, now - last) / 1000; // clamp long frames
      last = now;
      if (!entryInProgressRef.current) {
        const m = mapRef.current;
        if (m) {
          try {
            const c = m.getCenter();
            m.setCenter([c.lng + DEG_PER_SEC * dt, c.lat]);
          } catch { /* ignore */ }
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    autoRotateRef.current = raf;

    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      autoRotateRef.current = null;
    };
  }, [mapReady, selectedStory, selectedRegion, userDragged]);

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
  }, [mapReady]);

  return (
    <div ref={containerRef} className="globe-wrapper" style={{ position: 'absolute', inset: 0 }}>
      <AppMap
        ref={handleMapRef}
        surface="globe"
        theme={isLight ? 'light' : 'dark'}
        viewport={{
          center: [DEFAULT_VIEW.lng, DEFAULT_VIEW.lat],
          zoom: ENTRY_START_ZOOM,
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
