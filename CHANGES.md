# Map library migration: react-map-gl + react-globe.gl → mapcn / AppMap

## Summary

Both map surfaces (`FlatMap.jsx` and `Globe.jsx`) now render through a single
unified wrapper, `<AppMap>` (`src/components/AppMap.tsx`), which is backed by
the `mapcn` primitives in `src/components/ui/map.tsx`. The underlying renderer
is now a single `maplibre-gl` instance per screen — with the globe screen
simply using MapLibre's `projection: { type: 'globe' }` instead of a three.js
3D sphere.

All imperative GL state (sources, layers, feature-state, hover/click handlers,
the traveling arc-pulse `requestAnimationFrame` loop, the clustered articles
source, tracking icons, velocity-spike rings, selected-story markers, locality
labels) has been factored into a new shared child component:

- `src/components/MapGLOverlay.jsx` — uses `useMap()` from the mapcn primitives
  to get the raw MapLibre instance, adds all sources/layers imperatively, and
  handles cleanup on unmount. Paint expressions, thresholds, colors, timing,
  cluster radii, and icon-rotate logic were copied **verbatim** from the legacy
  `FlatMap.jsx`.

Per-surface UI that differs between screens was preserved outside the overlay:

- `FlatMap.jsx` keeps its macro-region drill-down, region-selector sidebar,
  breadcrumb, and locality labels (overlay gates the label layer on
  `surface === 'flat'`).
- `Globe.jsx` keeps auto-rotate behavior, now implemented via a
  `setInterval`-driven `map.easeTo` loop that pauses on user drag / wheel and
  when a region or story is selected.

## Removed dependencies

From `package.json`:

- `react-map-gl`
- `react-globe.gl`
- `three`
- `leaflet`
- `react-leaflet`
- `react-leaflet-cluster`

Kept: `maplibre-gl` (used directly by mapcn primitives).

## Vite config cleanup

`vite.config.js` previously had a `manualChunks` function that carved out
`vendor-globe` (three + react-globe.gl), `vendor-map` (maplibre-gl +
react-map-gl), and `vendor-leaflet` chunks. All three are obsolete after the
migration, so the entire `build.rollupOptions` section was removed. Rolldown/
Rollup's default code-splitting still produces separate chunks for the
lazy-loaded `Globe` / `FlatMap` / `MapGLOverlay` modules, which is what
matters for keeping the initial payload small.

## Test updates

`test/performance.test.js` previously asserted that:

- `Globe.jsx` imports `react-globe.gl`
- Vite config contains `vendor-globe` / `vendor-map` / `vendor-leaflet`
  manualChunks entries

Those assertions were inverted or replaced with:

- `Globe.jsx` and `FlatMap.jsx` both import `AppMap`
- `Globe.jsx` no longer imports `react-globe.gl` or `three`
- `FlatMap.jsx` no longer imports `react-map-gl`
- `App.jsx` still does not statically import `three` or `react-globe.gl`

The entire `describe('Vite build configuration', ...)` block was removed
because its assertions are no longer meaningful — there is no longer any
manual chunking configured in `vite.config.js`.

## Known visual / behavior differences vs legacy

- **Globe is no longer a three.js 3D sphere.** Country polygons now render as
  flat fill layers projected onto a MapLibre globe surface (i.e. a 2D sphere
  projection, not an extruded mesh). That means:
  - No per-country altitude extrusion on hover / selection / severity.
  - No atmosphere glow layer (MapLibre globe has its own subtle sky-tint but
    no configurable halo).
  - Tooltip content is rendered via the same MapLibre popup styles as the flat
    map, not HTML overlays positioned by three.js projection.
  - Arc rendering is 2D quadratic-Bézier (via MapLibre line layer) rather than
    3D great-circle arcs with altitude.
  The interaction model — hover, click, fly-to, arcs, rings, pulses, selected
  story marker, region select — is preserved.
- **Auto-rotate** on the globe is now approximated via `map.easeTo` ticks
  (~1.2°/s) instead of a physics-based orbit control. Pauses on drag / wheel
  / selection as before.
- `earth-night.jpg` and `night-sky.png` assets are no longer imported (MapLibre
  globe uses the vector tile style instead). The files remain in
  `src/assets/` in case they're desired for a future skin.
- `@types/react` and `@types/react-dom` were added as devDependencies. Without
  them `npx tsc --noEmit` failed pre-existingly on the `*.tsx` files
  (`AppMap.tsx` and `ui/map.tsx`) that were already in the repo.

## Follow-ups worth considering

- Swap the `setInterval`-based auto-rotate for a `requestAnimationFrame` loop
  with accumulated delta time for smoother rotation, especially on displays
  with > 60 Hz refresh.
- If the 3D extrusion effect on the globe is missed, the current architecture
  could be extended by registering a `fill-extrusion` layer and synthesizing a
  per-feature `height` property from severity — MapLibre supports this natively
  and would survive the globe projection.
- The `MapGLOverlay` bundle is ~1.4 MB (~408 kB gzipped) due to the bundled
  GeoJSON of country polygons; code-splitting that asset as a runtime fetch
  (already structured this way — it's `fetch(countriesUrl)`) ensures it's
  loaded lazily, but the `@/components/ui/map` primitives themselves also pull
  in MapLibre. This matches the previous `vendor-map` chunk size.
