/** Natural Earth 1:110m land, coastline and internal borders as GeoJSON, baked by scripts/build-client.mjs. */
declare module 'virtual:basemap' {
  import type { Feature } from 'geojson';
  export const borders: Feature;
  export const coast: Feature;
  export const land: Feature;
}
