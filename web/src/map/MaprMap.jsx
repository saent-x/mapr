import { useRef, useEffect, useMemo } from "react";
import maplibregl from "maplibre-gl";

// Professional vector basemaps (free, no key). Override via env to self-host.
const DARK_STYLE = import.meta.env.VITE_MAP_STYLE || "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const LIGHT_STYLE = import.meta.env.VITE_MAP_STYLE_LIGHT || "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const basemapFor = (theme) => (theme === "light" ? LIGHT_STYLE : DARK_STYLE);
const WORLD_URL = `${import.meta.env.BASE_URL}world.geo.json`;

// Theme-aware severity ramp: cohesive green → gold → coral → oxblood. The old
// magenta "catastrophic" clashed with the warm tiers; oxblood reads as "worst"
// while staying in family. Light variants are darker to hold up on positron.
const TIER = {
  dark: { green: "#5a9e74", amber: "#d6a23f", red: "#cc5d44", black: "#9c3f4e" },
  light: { green: "#2e855a", amber: "#b3771a", red: "#be3e2b", black: "#872f43" },
};
const HOVER_HEX = { dark: "#e8a33d", light: "#b27518" };
const palFor = (theme) => TIER[theme === "light" ? "light" : "dark"];
const NODATA = { dark: "#0e0e0e", light: "#fafaf8" }; // matches each basemap's land → no-data blends in (fill-extrusion ignores color alpha, so this must be the land color, not transparent)
const FLAT_PITCH = 0; // flat map stays top-down (never bent); 3D pop is globe-only
const HOVER = ["boolean", ["feature-state", "hover"], false];
const SELECTED = ["boolean", ["feature-state", "selected"], false];
const tierMatch = (pal, fallback) => [
  "match", ["get", "tier"],
  "red", pal.red, "black", pal.black, "amber", pal.amber, "green", pal.green,
  fallback,
];
const markerColor = (pal) => [
  "match", ["get", "tier"],
  "red", pal.red, "black", pal.black, "amber", pal.amber, "green", pal.green,
  pal.green,
];
const EMPTY_FC = { type: "FeatureCollection", features: [] };

function toFeatures(events) {
  const now = Date.now();
  return {
    type: "FeatureCollection",
    features: events
      .filter((e) => Number.isFinite(e.lon) && Number.isFinite(e.lat))
      .map((e) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [e.lon, e.lat] },
        properties: { id: String(e._id), tier: e.tier, severity: e.severity, live: now - e.publishedAt < 3_600_000 },
      })),
  };
}
const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const GLOBAL_OVERVIEW_CENTER = [14, 24];
const clamp = (min, value, max) => Math.max(min, Math.min(max, value));

function viewportSize(container) {
  const rect = container?.getBoundingClientRect?.();
  return {
    width: Math.max(1, rect?.width || window.innerWidth || 1024),
    height: Math.max(1, rect?.height || window.innerHeight || 720),
  };
}

function overviewCamera(mode, container) {
  const { width, height } = viewportSize(container);
  const fit = clamp(0, (Math.min(width, height) - 280) / 680, 1);
  const zoom = mode === "globe"
    ? 0.95 + fit * 1.55
    : 1.52 + fit * 0.88;

  return {
    center: GLOBAL_OVERVIEW_CENTER,
    zoom,
    pitch: mode === "globe" ? 0 : FLAT_PITCH,
    bearing: 0,
  };
}

// Focus zoom from a feature's bbox span (bigger country → zoom out more).
function regionZoom(feature) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const scanRing = (ring) => {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  };
  const g = feature.geometry;
  if (g.type === "Polygon") g.coordinates.forEach(scanRing);
  else if (g.type === "MultiPolygon") g.coordinates.forEach((poly) => poly.forEach(scanRing));
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  return Math.max(2.6, Math.min(5.2, Math.log2(360 / span) - 0.2));
}

// Great-circle arc between two [lon,lat] points (slerp); longitudes unwrapped
// so the line stays continuous across the antimeridian on the flat map.
function greatCircleArc(a, b, steps) {
  const R = Math.PI / 180, D = 180 / Math.PI;
  const lat1 = a[1] * R, lon1 = a[0] * R, lat2 = b[1] * R, lon2 = b[0] * R;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2));
  if (!Number.isFinite(d) || d === 0) return [a, b];
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([Math.atan2(y, x) * D, Math.atan2(z, Math.sqrt(x * x + y * y)) * D]);
  }
  for (let i = 1; i < pts.length; i++) {
    const delta = pts[i][0] - pts[i - 1][0];
    if (delta > 180) pts[i][0] -= 360;
    else if (delta < -180) pts[i][0] += 360;
  }
  return pts;
}

// Arcs link regions whose events share news entities (weight = shared-entity
// count). Skip singletons + over-generic entities (>6 regions) to avoid a
// hairball; cap to the strongest links.
function buildArcs(events, world) {
  if (!world) return EMPTY_FC;
  const center = new Map();
  for (const f of world.features) if (f.properties?.iso) center.set(f.properties.iso, [f.properties.cx, f.properties.cy]);
  const entRegions = new Map();
  for (const e of events) {
    if (!e.isoA2 || !center.has(e.isoA2) || !e.entities) continue;
    for (const ent of e.entities) {
      if (!ent) continue;
      let s = entRegions.get(ent);
      if (!s) { s = new Set(); entRegions.set(ent, s); }
      s.add(e.isoA2);
    }
  }
  const edges = new Map();
  for (const regions of entRegions.values()) {
    if (regions.size < 2 || regions.size > 6) continue;
    const arr = [...regions];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = arr[i] < arr[j] ? `${arr[i]}|${arr[j]}` : `${arr[j]}|${arr[i]}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
  }
  const features = [...edges.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 44)
    .map(([key, weight]) => {
      const [a, b] = key.split("|");
      return { type: "Feature", properties: { weight }, geometry: { type: "LineString", coordinates: greatCircleArc(center.get(a), center.get(b), 48) } };
    });
  return { type: "FeatureCollection", features };
}

function addOverlay(map, theme) {
  const pal = palFor(theme);
  const hover = HOVER_HEX[theme === "light" ? "light" : "dark"];
  const stroke = theme === "light" ? "#f3f1ea" : "#0b0d10";
  const opacity = theme === "light" ? 0.42 : 0.55;
  if (!map.getSource("countries")) map.addSource("countries", { type: "geojson", data: WORLD_URL, promoteId: "iso" });
  if (!map.getSource("events")) map.addSource("events", { type: "geojson", data: EMPTY_FC });
  // Only the hovered/selected region(s) live here → a raised 3D pop without a
  // full-coverage extrusion (which z-fought the globe surface → color flicker).
  if (!map.getSource("active")) map.addSource("active", { type: "geojson", data: EMPTY_FC });
  if (!map.getSource("arcs")) map.addSource("arcs", { type: "geojson", data: EMPTY_FC });

  // Base choropleth is a flat FILL: it hugs the surface on globe + flat (no
  // depth-buffer z-fighting, no flicker). Hover/selected brighten to amber.
  const active = ["any", SELECTED, HOVER];
  map.addLayer({
    id: "country-fill",
    type: "fill",
    source: "countries",
    paint: {
      "fill-color": ["case", active, hover, tierMatch(pal, NODATA[theme === "light" ? "light" : "dark"])],
      "fill-opacity": ["case", active, theme === "light" ? 0.72 : 0.82, opacity],
      "fill-antialias": true,
      "fill-color-transition": { duration: 180 },
      "fill-opacity-transition": { duration: 180 },
    },
  });
  map.addLayer({
    id: "country-outline",
    type: "line",
    source: "countries",
    paint: {
      "line-color": hover,
      "line-width": ["case", SELECTED, 2.4, ["case", HOVER, 1.8, 0]],
      "line-opacity": ["case", active, 1, 0],
      "line-width-transition": { duration: 160 },
      "line-opacity-transition": { duration: 160 },
    },
  });
  // 3D pop: only the active region(s), raised so they never sit on the surface.
  map.addLayer({
    id: "active-3d",
    type: "fill-extrusion",
    source: "active",
    paint: {
      "fill-extrusion-color": hover,
      "fill-extrusion-opacity": 0.85,
      "fill-extrusion-height": [
        "interpolate", ["linear"], ["zoom"],
        0, ["case", ["==", ["get", "kind"], "selected"], 1200000, 800000],
        3, ["case", ["==", ["get", "kind"], "selected"], 450000, 280000],
        6, ["case", ["==", ["get", "kind"], "selected"], 120000, 70000],
      ],
      "fill-extrusion-base": 0,
      "fill-extrusion-vertical-gradient": false,
      "fill-extrusion-height-transition": { duration: 300 },
    },
  });
  // Arc lines linking regions with related (shared-entity) news.
  map.addLayer({
    id: "arcs",
    type: "line",
    source: "arcs",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": hover,
      "line-width": ["interpolate", ["linear"], ["get", "weight"], 1, 0.6, 6, 2.2],
      "line-opacity": theme === "light" ? 0.3 : 0.36,
      "line-blur": 0.6,
    },
  });

  map.addLayer({
    id: "events-heat",
    type: "heatmap",
    source: "events",
    layout: { visibility: "none" },
    paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["get", "severity"], 0, 0.2, 10, 1],
      "heatmap-intensity": 0.7,
      "heatmap-radius": 34,
      "heatmap-opacity": 0.75,
      "heatmap-color": [
        "interpolate", ["linear"], ["heatmap-density"],
        0, "rgba(0,0,0,0)", 0.3, "rgba(61,155,107,0.4)", 0.6, "rgba(232,163,61,0.55)", 1, "rgba(217,83,59,0.85)",
      ],
    },
  });
  map.addLayer({
    id: "events-pulse",
    type: "circle",
    source: "events",
    filter: ["==", ["get", "live"], true],
    paint: { "circle-radius": 4, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": markerColor(pal), "circle-stroke-width": 1, "circle-stroke-opacity": 0 },
  });
  map.addLayer({
    id: "events-core",
    type: "circle",
    source: "events",
    paint: {
      "circle-radius": ["+", 2.5, ["*", ["coalesce", ["get", "severity"], 0], 0.6]],
      "circle-color": markerColor(pal),
      "circle-stroke-color": stroke,
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: "events-active",
    type: "circle",
    source: "events",
    filter: ["==", ["get", "id"], "__none__"],
    paint: { "circle-radius": ["+", 7, ["*", ["coalesce", ["get", "severity"], 0], 0.6]], "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": hover, "circle-stroke-width": 1.6 },
  });
}

/**
 * MapLibre GL tactical map. Theme-aware professional basemap (dark-matter /
 * positron). Countries = severity choropleth via one fill-extrusion that pops
 * up in amber on hover — the flat map highlights in place (no tilt); the globe
 * pops the region up in 3D and slowly auto-rotates. Markers + heatmap on top.
 */
export default function MaprMap({ events, coverage, mode, layers, activeEventId, theme, focusIso, onEventClick, onRegionClick }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const eventsRef = useRef(events);
  const handlersRef = useRef({ onEventClick, onRegionClick });
  const readyRef = useRef(false);
  const hoverIdRef = useRef(null);
  const selectedIdRef = useRef(null);
  const savedCamRef = useRef(null);
  const popupRef = useRef(null);
  const worldRef = useRef(null);
  const modeRef = useRef(mode);
  const themeRef = useRef(theme);
  const lastInteractRef = useRef(0);

  eventsRef.current = events;
  handlersRef.current = { onEventClick, onRegionClick };
  modeRef.current = mode;
  themeRef.current = theme;

  // Choropleth + hover stats come from the full per-region coverage rollup (all
  // events in the window), so countries tint even when their events fall outside
  // the recency-capped marker feed.
  const byIso = useMemo(() => {
    const m = new Map();
    for (const c of coverage ?? []) {
      if (c.iso) m.set(c.iso, { count: c.count, maxSev: c.maxSev, tier: c.tier });
    }
    return m;
  }, [coverage]);
  const byIsoRef = useRef(byIso);
  byIsoRef.current = byIso;

  const applyOverviewCamera = (nextMode = modeRef.current, { duration = 0, force = false } = {}) => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (!force && selectedIdRef.current != null) return;
    map.easeTo({
      ...overviewCamera(nextMode, containerRef.current),
      duration: prefersReducedMotion() ? 0 : duration,
    });
  };

  const paintChoropleth = () => {
    const map = mapRef.current;
    const world = worldRef.current;
    if (!map || !readyRef.current || !world || !map.getSource("countries")) return;
    const next = byIsoRef.current;
    const features = world.features.map((f) => {
      const s = f.properties?.iso ? next.get(f.properties.iso) : null;
      return s
        ? { ...f, properties: { ...f.properties, tier: s.tier, sev: s.maxSev, count: s.count } }
        : { ...f, properties: { ...f.properties, tier: null, sev: 0, count: 0 } };
    });
    map.getSource("countries").setData({ type: "FeatureCollection", features });
    if (selectedIdRef.current != null) map.setFeatureState({ source: "countries", id: selectedIdRef.current }, { selected: true });
    if (hoverIdRef.current != null) map.setFeatureState({ source: "countries", id: hoverIdRef.current }, { hover: true });
  };

  // Mirror the hovered/selected region(s) into the `active` source so only they
  // get the raised 3D extrusion (kind drives height: selected taller).
  const updateActive = () => {
    const map = mapRef.current;
    const world = worldRef.current;
    if (!map || !readyRef.current || !world || !map.getSource("active")) return;
    const sel = selectedIdRef.current;
    const hov = hoverIdRef.current;
    const find = (iso) => world.features.find((f) => f.properties?.iso === iso);
    const features = [];
    if (sel != null) { const f = find(sel); if (f) features.push({ ...f, properties: { ...f.properties, kind: "selected" } }); }
    if (hov != null && hov !== sel) { const f = find(hov); if (f) features.push({ ...f, properties: { ...f.properties, kind: "hover" } }); }
    map.getSource("active").setData({ type: "FeatureCollection", features });
  };

  // Arc lines linking regions with related (shared-entity) news.
  const paintArcs = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getSource("arcs")) return;
    map.getSource("arcs").setData(buildArcs(eventsRef.current, worldRef.current));
  };

  // (Re)build the overlay on every style load (initial + theme switch).
  const onStyleReady = () => {
    const map = mapRef.current;
    if (!map) return;
    addOverlay(map, themeRef.current);
    try { map.setProjection({ type: modeRef.current === "globe" ? "globe" : "mercator" }); } catch { /* noop */ }
    map.getSource("events")?.setData(toFeatures(eventsRef.current));
    readyRef.current = true;
    paintChoropleth();
    updateActive();
    paintArcs();
  };

  useEffect(() => {
    fetch(WORLD_URL).then((r) => r.json()).then((fc) => { worldRef.current = fc; paintChoropleth(); paintArcs(); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const initialCamera = overviewCamera(modeRef.current, containerRef.current);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemapFor(themeRef.current),
      center: initialCamera.center,
      zoom: initialCamera.zoom,
      pitch: initialCamera.pitch,
      bearing: initialCamera.bearing,
      attributionControl: { compact: true },
      dragRotate: false,
      maxPitch: 60,
      maxZoom: 12,
      minZoom: 0.8,
    });
    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "map-pop" });

    map.on("style.load", onStyleReady);

    const noteInteract = () => { lastInteractRef.current = performance.now(); };
    map.on("mousedown", noteInteract);
    map.on("touchstart", noteInteract);
    map.on("wheel", noteInteract);
    map.on("dragstart", noteInteract);

    const byId = () => new Map(eventsRef.current.map((e) => [String(e._id), e]));
    map.on("click", "events-core", (e) => {
      const ev = byId().get(e.features?.[0]?.properties?.id);
      if (ev) handlersRef.current.onEventClick?.(ev);
    });
    map.on("click", "country-fill", (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: ["events-core"] }).length) return;
      const iso = e.features?.[0]?.properties?.iso;
      if (iso) handlersRef.current.onRegionClick?.(String(iso));
    });
    map.on("mousemove", "country-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      map.getCanvas().style.cursor = "pointer";
      const fid = f.properties?.iso ?? f.id;
      if (hoverIdRef.current !== fid) {
        if (hoverIdRef.current != null) map.setFeatureState({ source: "countries", id: hoverIdRef.current }, { hover: false });
        hoverIdRef.current = fid;
        if (fid != null) map.setFeatureState({ source: "countries", id: fid }, { hover: true });
        updateActive();
      }
      const s = f.properties?.iso ? byIsoRef.current.get(f.properties.iso) : null;
      const stats = s
        ? `<b style="color:${palFor(themeRef.current)[s.tier]}">${s.tier.toUpperCase()} ${s.maxSev.toFixed(1)}</b> · ${s.count} event${s.count === 1 ? "" : "s"}`
        : "no active events";
      popupRef.current.setLngLat(e.lngLat).setHTML(`<span class="mp-name">${f.properties?.name ?? ""}</span><span class="mp-stat">${stats}</span>`).addTo(map);
    });
    map.on("mouseleave", "country-fill", () => {
      map.getCanvas().style.cursor = "";
      if (hoverIdRef.current != null) map.setFeatureState({ source: "countries", id: hoverIdRef.current }, { hover: false });
      hoverIdRef.current = null;
      updateActive();
      popupRef.current?.remove();
    });
    map.on("mouseenter", "events-core", () => { map.getCanvas().style.cursor = "pointer"; });

    // Globe slow auto-rotate (paused while/after interaction; reduced-motion off).
    let raf;
    let lastTs = performance.now();
    const spin = (ts) => {
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      if (mapRef.current && readyRef.current && modeRef.current === "globe" && !prefersReducedMotion()
          && performance.now() - lastInteractRef.current > 2500 && selectedIdRef.current == null) {
        const c = mapRef.current.getCenter();
        let lng = c.lng + dt * 5; // ~5°/s
        if (lng > 180) lng -= 360;
        mapRef.current.setCenter([lng, c.lat]);
      }
      raf = requestAnimationFrame(spin);
    };
    raf = requestAnimationFrame(spin);

    let resizeRaf = 0;
    const handleResize = () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        if (!mapRef.current) return;
        mapRef.current.resize();
        if (readyRef.current && selectedIdRef.current == null) {
          applyOverviewCamera(modeRef.current, { duration: 280 });
        }
      });
    };
    let observer;
    if (typeof ResizeObserver !== "undefined" && containerRef.current) {
      observer = new ResizeObserver(handleResize);
      observer.observe(containerRef.current);
    }
    window.addEventListener("resize", handleResize);

    return () => {
      readyRef.current = false;
      window.removeEventListener("resize", handleResize);
      observer?.disconnect();
      cancelAnimationFrame(resizeRaf);
      cancelAnimationFrame(raf);
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme → swap basemap (style.load re-adds the overlay).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setStyle(basemapFor(theme));
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.getSource("events")?.setData(toFeatures(events));
    paintChoropleth();
    paintArcs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  useEffect(() => {
    if (!mapRef.current || !readyRef.current) return;
    paintChoropleth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverage]);

  // Region click/select → focus the camera on it + raise it; restore on close.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const prev = selectedIdRef.current;
    if (prev != null && prev !== focusIso) {
      map.setFeatureState({ source: "countries", id: prev }, { selected: false });
    }
    if (focusIso) {
      if (selectedIdRef.current == null) {
        const c = map.getCenter();
        savedCamRef.current = { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
      }
      selectedIdRef.current = focusIso;
      map.setFeatureState({ source: "countries", id: focusIso }, { selected: true });
      updateActive();
      const feat = worldRef.current?.features.find((f) => f.properties?.iso === focusIso);
      if (feat) {
        lastInteractRef.current = performance.now();
        map.easeTo({
          center: [feat.properties.cx, feat.properties.cy],
          zoom: regionZoom(feat),
          pitch: modeRef.current === "globe" ? 0 : FLAT_PITCH,
          duration: 800,
        });
      }
    } else {
      selectedIdRef.current = null;
      updateActive();
      const saved = savedCamRef.current;
      if (saved) {
        map.easeTo({ center: saved.center, zoom: saved.zoom, pitch: saved.pitch, bearing: saved.bearing, duration: 700 });
        savedCamRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIso]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    try {
      map.setProjection({ type: mode === "globe" ? "globe" : "mercator" });
      // Globe: 3D sphere. Flat: top-down. Both recenter to the responsive overview.
      applyOverviewCamera(mode, { duration: 600, force: true });
    } catch { /* noop */ }
  }, [mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("events-heat")) return;
    map.setLayoutProperty("events-heat", "visibility", layers.heat ? "visible" : "none");
  }, [layers.heat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("events-active")) return;
    map.setFilter("events-active", ["==", ["get", "id"], activeEventId ?? "__none__"]);
  }, [activeEventId]);

  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    let raf;
    const period = 2400;
    const tick = (ts) => {
      const map = mapRef.current;
      if (map && readyRef.current && map.getLayer("events-pulse")) {
        const phase = (ts % period) / period;
        map.setPaintProperty("events-pulse", "circle-radius", 4 + phase * 16);
        map.setPaintProperty("events-pulse", "circle-stroke-opacity", 0.7 * (1 - phase));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="map-stage" ref={containerRef}>
    </div>
  );
}
