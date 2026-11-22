/** Natural Earth 1:110m internal country borders as GeoJSON, baked by scripts/build-client.mjs. */
declare module 'virtual:basemap' {
  export const borders: { type: 'Feature'; properties: unknown; geometry: { type: string; coordinates: unknown } };
}
