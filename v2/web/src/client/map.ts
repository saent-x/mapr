import 'maplibre-gl/dist/maplibre-gl.css';
import { AttributionControl, LngLatBounds, Map as GlMap, type GeoJSONSource, type MapGeoJSONFeature, type StyleSpecification } from 'maplibre-gl';
import { borders } from 'virtual:basemap';
import { countryShapes } from './geo';
import baseStyle from './style.json';

export type Projection = 'mercator' | 'globe';

/** Meridians and parallels every 30°, densified so they curve on the globe. */
function graticule() {
  const lines: Array<Array<[number, number]>> = [];
  const range = (a: number, b: number, step: number) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);
  for (const lon of range(-180, 150, 30)) lines.push(range(-80, 80, 5).map((lat) => [lon, lat]));
  // Parallels in 30° pieces: one line spanning the full ±180 is dropped by tiling in some copies.
  for (const lat of range(-60, 60, 30)) for (const lon0 of range(-180, 150, 30)) lines.push(range(lon0, lon0 + 30, 5).map((lon) => [lon, lat]));
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'MultiLineString' as const, coordinates: lines } };
}

/** Our style with the bundled basemap filled in: drawn under the tiles, so the map is never blank. */
function deskStyle(): StyleSpecification {
  const s = structuredClone(baseStyle) as unknown as StyleSpecification;
  const set = (id: string, data: unknown) => ((s.sources[id] as { data: unknown }).data = data);
  set('ne_countries', countryShapes);
  set('ne_borders', borders);
  set('graticule', graticule());
  return s;
}

/** A mark on the map: one event with coordinates, or one country holding events placed only by country. */
export interface Mark {
  key: string;
  at: [number, number];
  /** 0–4. */
  sev: number;
  count: number;
  eventId: number | null;
  country: string | null;
}

const PROJECTION_KEY = 'mapr.projection';
// Required by the OpenMapTiles / ODbL licences. Set on the control so it shows even before tiles load.
const ATTRIBUTION = [
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>',
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a>',
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>',
];

export function storedProjection(): Projection {
  try {
    return localStorage.getItem(PROJECTION_KEY) === 'globe' ? 'globe' : 'mercator';
  } catch {
    return 'mercator';
  }
}

export interface DeskMapHandlers {
  onEvent(id: number): void;
  onCountry(a2: string): void;
  /** Pointer over a country (or off all countries: null), with the pointer's position in the map box. */
  onHover(a2: string | null, x: number, y: number): void;
}

export interface DeskMap {
  setMarks(marks: Mark[]): void;
  /** Country fill strength 0–1, by ISO alpha-2. */
  setTint(values: Map<string, number>): void;
  setSelected(key: string | null): void;
  setHover(a2: string | null): void;
  /** Fit the map to points; `cover` is how many px a bottom sheet hides on a phone. */
  fit(points: Array<[number, number]>, cover?: number): void;
  home(): void;
  zoom(by: number): void;
  setProjection(p: Projection): void;
}

export function createMap(container: HTMLElement, on: DeskMapHandlers): DeskMap {
  let projection = storedProjection();
  let selected: string | null = null;
  let hovered: string | null = null;
  let marks: GeoJSON = { type: 'FeatureCollection', features: [] };
  let tint = new Map<string, number>();
  let ready = false;
  /** Globe sized to ~85% of the free height (a globe's diameter is 512·2^z/π px); flat at world view. */
  const narrow = () => container.clientWidth < 900;
  const globeZoom = () => Math.log2((0.85 * Math.min(container.clientWidth, narrow() ? container.clientHeight - 220 : container.clientHeight - 120) * Math.PI) / 512);
  const home = { center: [15, 20] as [number, number], zoom: () => (projection === 'globe' ? globeZoom() : container.clientWidth < 600 ? 0.9 : 1.4) };

  const map = new GlMap({
    container,
    style: deskStyle(),
    center: home.center,
    zoom: home.zoom(),
    minZoom: 0,
    maxZoom: 12,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    renderWorldCopies: true,
  });
  map.touchZoomRotate.disableRotation();
  // On a phone the feed and chat input cover the lower part: centre the map in the space above.
  if (narrow()) map.setPadding({ top: 56, bottom: 150, left: 0, right: 0 });
  map.keyboard.disable(); // j/k belong to the feed
  map.addControl(new AttributionControl({ compact: true, customAttribution: ATTRIBUTION }), 'bottom-right');
  // Start the credits folded to their (i) button; they open on click.
  const fold = () => container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  map.once('load', fold);
  map.once('idle', fold);

  const applyTint = () => {
    if (!ready) return;
    map.removeFeatureState({ source: 'ne_countries' });
    for (const [a2, v] of tint) map.setFeatureState({ source: 'ne_countries', id: a2 }, { v });
    if (hovered) map.setFeatureState({ source: 'ne_countries', id: hovered }, { hover: true });
  };
  const applySelected = () => {
    if (!ready) return;
    map.setFilter('mark-ring', ['==', ['get', 'key'], selected ?? '']);
  };

  map.on('style.load', () => {
    map.setProjection({ type: projection });
    map.addSource('marks', { type: 'geojson', data: marks });
    const base = ['min', 16, ['+', 2.5, ['*', 0.8, ['get', 'sev']], ['*', 1.4, ['sqrt', ['-', ['get', 'count'], 1]]]]];
    // Smaller marks on a world-sized map so countries stay readable; full size from zoom 3.
    const sized = (k: number, add = 0) => ['interpolate', ['linear'], ['zoom'], 0, ['+', add, ['*', 0.55 * k, base]], 3, ['+', add, ['*', k, base]]];
    map.addLayer({
      id: 'mark-halo',
      type: 'circle',
      source: 'marks',
      paint: {
        'circle-radius': sized(2.2) as never,
        'circle-color': '#FF5A1F',
        'circle-opacity': ['interpolate', ['linear'], ['get', 'sev'], 0, 0.04, 4, 0.12] as never,
        'circle-pitch-alignment': 'map',
      },
    });
    map.addLayer({
      id: 'mark-ring',
      type: 'circle',
      source: 'marks',
      filter: ['==', ['get', 'key'], ''],
      paint: {
        'circle-radius': sized(1, 5) as never,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#141414',
        'circle-stroke-width': 2,
        'circle-pitch-alignment': 'map',
      },
    });
    map.addLayer({
      id: 'mark-dot',
      type: 'circle',
      source: 'marks',
      layout: { 'circle-sort-key': ['get', 'sev'] as never },
      paint: {
        'circle-radius': sized(1) as never,
        'circle-color': '#FF5A1F',
        'circle-opacity': ['interpolate', ['linear'], ['get', 'sev'], 0, 0.45, 1, 0.6, 4, 1] as never,
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 1.5,
        'circle-pitch-alignment': 'map',
      },
    });
    ready = true;
    applyTint();
    applySelected();
  });

  map.on('click', 'mark-dot', (e) => {
    const p = e.features?.[0]?.properties as { eventId?: number; country?: string } | undefined;
    if (!p) return;
    if (typeof p.eventId === 'number' && p.eventId >= 0) on.onEvent(p.eventId);
    else if (p.country) on.onCountry(p.country);
  });
  map.on('click', 'tint', (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: ['mark-dot'] }).length) return;
    const a2 = (e.features?.[0] as MapGeoJSONFeature | undefined)?.id;
    if (typeof a2 === 'string') on.onCountry(a2);
  });
  map.on('mousemove', 'tint', (e) => {
    const a2 = (e.features?.[0] as MapGeoJSONFeature | undefined)?.id;
    map.getCanvas().style.cursor = 'pointer';
    on.onHover(typeof a2 === 'string' ? a2 : null, e.point.x, e.point.y);
  });
  map.on('mouseleave', 'tint', () => {
    map.getCanvas().style.cursor = '';
    on.onHover(null, 0, 0);
  });

  return {
    setMarks(list) {
      marks = {
        type: 'FeatureCollection',
        features: list.map((m) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: m.at },
          properties: { key: m.key, sev: m.sev, count: m.count, eventId: m.eventId ?? -1, country: m.country ?? '' },
        })),
      };
      if (ready) (map.getSource('marks') as GeoJSONSource).setData(marks);
    },
    setTint(values) {
      tint = values;
      applyTint();
    },
    setSelected(key) {
      selected = key;
      applySelected();
    },
    setHover(a2) {
      if (a2 === hovered) return;
      if (ready && hovered) map.setFeatureState({ source: 'ne_countries', id: hovered }, { hover: false });
      hovered = a2;
      if (ready && a2) map.setFeatureState({ source: 'ne_countries', id: a2 }, { hover: true });
    },
    fit(points, cover = 0) {
      if (!points.length) return;
      const b = new LngLatBounds(points[0], points[0]);
      for (const p of points) b.extend(p);
      map.fitBounds(b, {
        padding: narrow() ? { top: 40, bottom: 40 + Math.max(0, cover - 150), left: 24, right: 24 } : { top: 90, bottom: 150, left: 340, right: 300 },
        maxZoom: 5,
        duration: 900,
      });
    },
    home() {
      map.easeTo({ center: home.center, zoom: home.zoom(), duration: 700 });
    },
    zoom(by) {
      map.easeTo({ zoom: map.getZoom() + by, duration: 250 });
    },
    setProjection(p) {
      projection = p;
      try {
        localStorage.setItem(PROJECTION_KEY, p);
      } catch {
        // private window or blocked storage: the choice lasts this visit only
      }
      map.setProjection({ type: p });
      // A globe at world zoom is a small disc; open it at a size that fills the box.
      if (p === 'globe' && map.getZoom() < globeZoom()) map.easeTo({ zoom: globeZoom(), duration: 400 });
    },
  };
}

type GeoJSON = { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: Record<string, unknown> }> };
