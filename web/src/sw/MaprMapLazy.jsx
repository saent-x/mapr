/* MaprMapLazy — defers the MapLibre/mapcn map (and its ~1MB vendor chunk) so
   the cold-open + composer paint immediately. React.lazy pulls MaprMap.jsx on
   demand; until it resolves we show a lightweight on-brand skeleton in place of
   the canvas. Props are forwarded verbatim, so behaviour is identical. */
import React, { lazy, Suspense } from "react";

// MaprMap is a named export; adapt it to the default export React.lazy expects.
const MaprMap = lazy(() =>
  import("./MaprMap.jsx").then((m) => ({ default: m.MaprMap }))
);

// .map-wrap already paints var(--map-bg) over the full stage, so the fallback is
// indistinguishable from the basemap loading in — no flash of unstyled stage.
function MapSkeleton() {
  return <div className="map-wrap" data-dimmed="1" aria-hidden="true" />;
}

export function MaprMapLazy(props) {
  return (
    <Suspense fallback={<MapSkeleton />}>
      <MaprMap {...props} />
    </Suspense>
  );
}

export default MaprMapLazy;
