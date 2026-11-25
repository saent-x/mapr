// The basemap the desk draws on: country shapes keyed by ISO alpha-2, plus land, coast and
// internal borders. All of it is bundled (Natural Earth 1:110m, public domain).
import { geoArea, geoBounds } from 'd3';
import type { Feature, Geometry, MultiPolygon, Polygon, Position } from 'geojson';
import { borders, coast, land } from 'virtual:basemap';
import { countries, countryShapes } from './geo';

export interface CountryFeature extends Feature<Polygon | MultiPolygon> {
  properties: { a2: string; name: string };
}

export interface World {
  feats: CountryFeature[];
  byA2: Map<string, CountryFeature>;
  land: Feature;
  borders: Feature;
  coast: Feature;
}

/** d3 wants exterior rings clockwise; RFC 7946 files wind them the other way. */
function rewind(f: CountryFeature): CountryFeature {
  if (geoArea(f) <= 2 * Math.PI) return f;
  const flip = (rings: Position[][]) => rings.map((r) => r.slice().reverse());
  const g = f.geometry;
  const geometry: Geometry =
    g.type === 'Polygon' ? { type: 'Polygon', coordinates: flip(g.coordinates) } : { type: 'MultiPolygon', coordinates: g.coordinates.map(flip) };
  return { ...f, geometry } as CountryFeature;
}

let world: World | null = null;

export function getWorld(): World {
  if (world) return world;
  const feats = (countryShapes.features as Array<Feature<Polygon | MultiPolygon, { a2: string; n: string }>>).map((f) =>
    rewind({ type: 'Feature', geometry: f.geometry, properties: { a2: f.properties.a2, name: f.properties.n } }),
  );
  world = { feats, byA2: new Map(feats.map((f) => [f.properties.a2, f])), land, borders, coast };
  return world;
}

/** [west, south, east, north] around a country, or null when it wraps the antimeridian (Russia, Fiji). */
export function countryBox(a2: string): [number, number, number, number] | null {
  const f = getWorld().byA2.get(a2);
  if (f) {
    const [[w, s], [e, n]] = geoBounds(f);
    if (w <= e) return [w, s, e, n];
  }
  const at = countries.get(a2)?.at;
  return at ? [at[0] - 2, at[1] - 2, at[0] + 2, at[1] + 2] : null;
}
