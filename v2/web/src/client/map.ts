import 'maplibre-gl/dist/maplibre-gl.css';
import { AttributionControl, Map as GlMap, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import type { MaprEvent } from '../types';
import { borders, land } from 'virtual:basemap';
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
  set('ne_land', land);
  set('ne_borders', borders);
  set('graticule', graticule());
  return s;
}

interface EventFeature {
  type: 'Feature';
  id: number;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { id: number; sev: number };
}
interface EventCollection {
  type: 'FeatureCollection';
  features: EventFeature[];
}

const PROJECTION_KEY = 'mapr.projection';
const SEV = ['#8A8A8A', '#7C8794', '#E8B23A', '#F07F2D', '#F2463A'];
const RADIUS = [4, 4, 5, 6, 7.5];
// Required by the OpenMapTiles / ODbL licences. Set on the control so it shows even before tiles load.
const ATTRIBUTION = [
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>',
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a>',
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>',
];

function storedProjection(): Projection {
  try {
    return localStorage.getItem(PROJECTION_KEY) === 'globe' ? 'globe' : 'mercator';
  } catch {
    return 'mercator';
  }
}

function storeProjection(p: Projection) {
  try {
    localStorage.setItem(PROJECTION_KEY, p);
  } catch {
    // private window or blocked storage: the choice lasts this visit only
  }
}

const bySev = (values: Array<number | string>) =>
  ['match', ['get', 'sev'], 1, values[1], 2, values[2], 3, values[3], 4, values[4], values[0]] as unknown as string;

export interface DeskMap {
  setEvents(events: MaprEvent[]): void;
  setSelected(id: number | null, fly: boolean): void;
}

export function createMap(container: HTMLElement, onSelect: (id: number) => void): DeskMap {
  let projection = storedProjection();
  let selected: number | null = null;
  let pending: EventCollection = { type: 'FeatureCollection', features: [] };
  let ready = false;
  const coords = new Map<number, [number, number]>();

  const map = new GlMap({
    container,
    style: deskStyle(),
    center: [20, 20],
    zoom: projection === 'globe' ? 1.6 : 1.1,
    minZoom: 0.5,
    maxZoom: 12,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    renderWorldCopies: true,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disable(); // j/k belong to the list
  map.addControl(new AttributionControl({ compact: true, customAttribution: ATTRIBUTION }), 'bottom-right');

  map.on('style.load', () => {
    map.setProjection({ type: projection });
    map.addSource('events', { type: 'geojson', data: pending, promoteId: 'id' });
    map.addLayer({
      id: 'event-ring',
      type: 'circle',
      source: 'events',
      paint: {
        'circle-radius': ['+', bySev(RADIUS) as unknown as number, 4] as unknown as number,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#EDEDED',
        'circle-stroke-width': 2,
        'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 1, 0] as unknown as number,
        'circle-pitch-alignment': 'viewport',
      },
    });
    map.addLayer({
      id: 'event-dot',
      type: 'circle',
      source: 'events',
      layout: { 'circle-sort-key': ['get', 'sev'] as unknown as number },
      paint: {
        'circle-radius': bySev(RADIUS) as unknown as number,
        'circle-color': ['case', ['==', ['get', 'sev'], 0], 'rgba(0,0,0,0)', bySev(SEV)] as unknown as string,
        'circle-stroke-color': ['case', ['==', ['get', 'sev'], 0], SEV[0]!, '#101010'] as unknown as string,
        'circle-stroke-width': ['case', ['==', ['get', 'sev'], 0], 1.5, 1] as unknown as number,
        'circle-pitch-alignment': 'viewport',
      },
    });
    ready = true;
    if (selected !== null) map.setFeatureState({ source: 'events', id: selected }, { sel: true });
  });

  map.on('click', 'event-dot', (e) => {
    const id = Number(e.features?.[0]?.properties?.id);
    if (Number.isFinite(id)) onSelect(id);
  });
  map.on('mouseenter', 'event-dot', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'event-dot', () => (map.getCanvas().style.cursor = ''));

  // 2D / 3D switch, glyph only.
  const toggle = document.createElement('div');
  toggle.className = 'proj';
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Projection');
  const buttons = (['mercator', 'globe'] as const).map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p === 'mercator' ? '2D' : '3D';
    b.addEventListener('click', () => {
      projection = p;
      storeProjection(p);
      map.setProjection({ type: p });
      // A globe at world zoom is a small disc; open it at a size that fills the panel.
      if (p === 'globe' && map.getZoom() < 1.6) map.easeTo({ zoom: 1.6, duration: 400 });
      sync();
    });
    toggle.append(b);
    return [p, b] as const;
  });
  const sync = () => {
    for (const [p, b] of buttons) b.setAttribute('aria-pressed', String(p === projection));
  };
  sync();
  container.append(toggle);

  return {
    setEvents(events) {
      coords.clear();
      const features: EventFeature[] = [];
      for (const e of events) {
        if (e.lat === null || e.lon === null) continue;
        coords.set(e.id, [e.lon, e.lat]);
        features.push({
          type: 'Feature',
          id: e.id,
          geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
          properties: { id: e.id, sev: e.severity ?? 0 },
        });
      }
      pending = { type: 'FeatureCollection', features };
      if (ready) {
        (map.getSource('events') as GeoJSONSource).setData(pending);
        if (selected !== null) map.setFeatureState({ source: 'events', id: selected }, { sel: true });
      }
    },
    setSelected(id, fly) {
      if (ready && selected !== null) map.setFeatureState({ source: 'events', id: selected }, { sel: false });
      selected = id;
      if (id === null) return;
      if (ready) map.setFeatureState({ source: 'events', id }, { sel: true });
      const c = coords.get(id);
      if (fly && c) map.flyTo({ center: c, zoom: Math.max(map.getZoom(), 3), speed: 1.6, essential: false });
    },
  };
}
