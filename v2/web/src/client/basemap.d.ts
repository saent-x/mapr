/** Natural Earth 1:110m land and internal country borders as GeoJSON, baked by scripts/build-client.mjs. */
declare module 'virtual:basemap' {
  export const land: { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; properties: unknown; geometry: { type: string; coordinates: unknown } }> };
  export const borders: { type: 'Feature'; properties: unknown; geometry: { type: string; coordinates: unknown } };
}
