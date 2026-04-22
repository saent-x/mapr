# Design revamp — Mapr Console

Rebuilt the entire UI layer against the "Mapr Console" handoff bundle
(tactical dark, IBM Plex, amber+cyan severity palette). The map engine
(mapcn on top of `maplibre-gl`) was **not** changed; only the React shell,
panels, pages, and styling around it were replaced.

## Design bundle inventory

Pulled from `https://api.anthropic.com/v1/design/h/TBmdGIaZwf1ofkJKdSVR0Q`
(gzipped tar). Files consumed:

- `mapr/README.md` — coding-agent handoff note
- `mapr/chats/chat1.md` — system decisions (tactical dark, IBM Plex, SEV tiers)
- `mapr/project/Mapr Console.html` — target console entrypoint
- `mapr/project/styles.css` — token layer + component styles
- `mapr/project/shell.jsx` — brand, header, sidebar, news panel, mini-panels, filter drawer, timeline, article sheet
- `mapr/project/pages.jsx` — region, entities, trends, admin layouts
- `mapr/project/map.jsx` — SVG cartography prototype (not ported; our MapLibre engine is kept)
- `mapr/project/app.jsx` — wiring/route switcher
- `mapr/project/data.js` — fictional events dataset (not ported; the real `newsStore` feeds our data)

## Token layer

`src/index.css` has been fully rewritten. Design tokens now live in `:root`:

- Palette: `--bg-0..4`, `--ink-0..4`, `--line`, `--line-2`, `--amber`, `--cyan`, severity tiers
  `--sev-green` / `--sev-amber` / `--sev-red` / `--sev-black`
- Typography: `--ff-sans` (IBM Plex Sans), `--ff-mono` (IBM Plex Mono),
  `--ff-serif` (IBM Plex Serif); size scale `--fs-0..6`
- Density: `--row` / `--pad-x` / `--pad-y` / `--gap` with `html.density-compact|roomy` variants
- Motion: `--ease` cubic-bezier; small radii (`--radius: 2px`)

Legacy variables the stores / hooks still reference (`--accent`, `--critical`,
`--elevated`, `--watch`, `--low`, `--bg`, `--text`, etc.) are aliased onto the
new tokens so old code keeps its contract while the look is tactical.

No GridCN or shadcn preset was introduced. Tailwind is not used. `mapcn`
remains the only component registry and only provides the map primitives.

## Shell

| File | Status |
| --- | --- |
| `src/components/Layout.jsx` | **replaced** — full design shell: header + sidebar + main `<Outlet>` + status bar. Sidebar has map / entities / trends nav links; admin link intentionally absent (password-gated page). |
| `src/components/Header.jsx` | **replaced** — brand mark, search input, SEV/COV/GEO overlay chips (on `/` only), lang cycler, ops badge. Reads from stores directly so it can live above `<Outlet>`. |
| `src/App.jsx` | **replaced** — the `/` surface only. Keeps all data hooks (`useNewsStore`, `useFilterStore`, `useUIStore`, `useWatchStore`, `usePanelState`, `useBriefingStream`, `useTrackingOverlayData`), search/filter/entity memos, escape-key + URL-sync effects, `MapErrorBoundary` + `Suspense`. |
| `src/main.jsx` | unchanged — `Layout` already wraps `/`, `/region/:iso`, `/entities`, `/trends`, `/admin`. |

## Feature panels

| File | Status |
| --- | --- |
| `src/components/NewsPanel.jsx` | **replaced** — floating top-right feed panel + tactical article sheet. Keeps `useProgressiveList` (30 initial / 20 batches), `visibleNews.map`, sentinel, aria-labels. |
| `src/components/FilterDrawer.jsx` | **replaced** — chip-row filters for severity tier, score, confidence, time window, source tier, verification, language, sort order, hide-amplified. Reset / apply buttons. |
| `src/components/AnomalyPanel.jsx` | **replaced** — left mini-panel (sparkline rows). Fed by `buildAnomalyList` from velocity spikes + silence entries. Click row → `onRegionSelect`. |
| `src/components/WatchlistPanel.jsx` | **replaced** — left mini-panel with add-row form when expanded. |
| `src/components/NarrativePanel.jsx` | **replaced** — left mini-panel; clusters active news by category. |
| `src/components/EventTimeline.jsx` | **replaced** — bottom strip with severity-binned histogram, draggable cursor, play/pause/step/live buttons. Uses the existing `timelineHelpers.js` pure functions (tested separately). |
| `src/components/DataLoadingOverlay.jsx` | **rewritten** — tactical spinner + skeleton shimmer tiles. |
| `src/components/DataErrorBanner.jsx` | **rewritten** — red-line alert banner with retry. |
| `src/components/ErrorBoundary.jsx` | **rewritten** — minimal tactical fault card with retry. |
| `src/components/MapLoadingFallback.jsx`, `PageLoadingFallback.jsx` | **rewritten** — plain text-in-center fallbacks. |
| `src/components/EntityRelationshipGraph.jsx` | palette retuned only (tactical amber/cyan/sev-green); canvas force sim kept. |

## Pages

| File | Status |
| --- | --- |
| `src/pages/RegionDetailPage.jsx` | **replaced** — serif region name, ISO breadcrumb, stat row (avg severity, events, sources), filtered article list, lazy-loaded mini-map. |
| `src/pages/EntityExplorerPage.jsx` | **replaced** — tactical graph canvas with map-chrome corner labels, side panel (type + degree + connected nodes + related events + "SHOW ON MAP"). Still `React.lazy`'s the graph component. |
| `src/pages/TrendAnalysisPage.jsx` | **replaced** — four cards (regional volume line chart, category severity horizon chart, language-mix bar rows, top-entities list) built in-memory from the current news pool. |
| `src/pages/AdminPage.jsx` | kept — the password gate + dashboard test surface is extensive; reskinned only by the new tokens (status badges, KPI cards, sections, password gate). |
| `src/pages/HealthPage.jsx` | kept — `/health` route is outside the design but is part of production. |

## Map surfaces (mapcn, unchanged engine)

`AppMap` and `MapGLOverlay` are untouched. Both surfaces are first-class:

- `/` → `<FlatMap>` or `<Globe>` via `mapMode` in `uiStore`; toggle buttons at
  bottom-right.
- `/region/:iso` → mini-map tile uses `<FlatMap>` filtered to the region.

### Globe zoom + entry animation

`src/components/Globe.jsx` now:

- **Default zoom** raised from `1.2` → **`2.5`** (≈ 5× rendered surface area,
  since `2^(2.5 − 1.2) = 2^1.3 ≈ 2.46× linear ≈ 5.0× area`). Tuned against the
  design's "globe fills the main canvas" feel.
- **Entry animation** — on every fresh mount the camera jumps to
  `zoom = 1.2` (the old default, visually a small globe) and eases in to
  `zoom = 2.5` over **2000 ms** with `easeInOutCubic`. The in-flight flag
  blocks auto-rotate and selection `flyTo` from stealing the camera until the
  entry finishes. The flag resets on every mount, so navigating away and back
  replays the animation.

Flat map defaults unchanged.

## Interactions / motion polish

- Hover transitions on chips, news rows, watchlist/anomaly rows, side-nav
  items, timeline controls, filter/anomaly/watchlist toggle buttons
- `:focus-visible` rings on every interactive surface (keyboard-only)
- Article sheet slides in from the right (`@keyframes slideIn` over 220 ms)
- Globe entry animation (above)
- Toasts slide in with the same `slideIn` keyframe
- Skeleton shimmer on the data-loading overlay
- Intel ticker horizontal scroll (80 s linear loop) when events present
- Ops dot pulse (2 s)
- Map cursor changes to grab/grabbing during pan

## Files deleted

- `src/components/ArcPanel.jsx`
- `src/components/BriefingExport.jsx`
- `src/components/ChangesBanner.jsx`
- `src/components/SaveViewDialog.jsx`
- `src/components/ViewSwitcher.jsx`
- `src/components/ExpandableText.jsx`

None were referenced by the new shell; the ones still referenced anywhere
(`ArcPanel`, `BriefingExport`, `SaveViewDialog`) only showed up as imports
inside the old `App.jsx` which has been rewritten.

## Deferred / out of scope

- **Tweaks panel** (theme / density / map-style switcher shown in the design
  prototype). The design's tokens are wired into `:root`, and
  `html.density-compact|roomy` + `html.theme-*` selectors are present in the
  CSS, so hooking a UI control onto them is straightforward. Not added in this
  pass to avoid scope creep on a Zustand slice for a dev-only affordance.
- **Briefing export modal / save-view dialog** — not present in the design.
  Deleted; the `showExport` / `showSaveDialog` state remains in `uiStore` and
  the keyboard `Escape` handler so it can be reintroduced without store
  changes when/if the export flow is redesigned.
- **Extruded globe polygons** — the design's "very real map" still goes
  through MapLibre globe projection (2D on sphere), not three.js; this was
  already the case after the mapcn migration (see `CHANGES.md` history in
  `git log`).
- **Rich narrative timeline stages** — the narrative mini-panel shows
  category clusters, not the three-stage narrative arc the old
  `NarrativePanel` had. The design only calls for clusters, so the richer
  lifecycle view was dropped. The underlying `narrativeHelpers.js` still
  exists for reuse if a detail view is added later.

## Open questions for the user

1. Should the tweaks panel (theme / density / map-style switch) be wired up?
   All the CSS hooks exist; the question is whether the product surfaces this
   UI or keeps it compile-time.
2. The admin dashboard was not rewritten against the design spec — its
   password gate + test surface are large. Reskin only, or full rewrite?
3. The saved-views feature was removed from the visible UI. Is that a
   product decision (keep it gone), or should it reappear somewhere in the
   tactical shell?

## Verification

- `npx tsc --noEmit` — clean
- `npm run build` — succeeds
- `npm test` — 539 pass / 4 skipped / 0 fail (543 total)
- `npm run dev:frontend` — boots on the default vite port

No interactive browser testing was possible in this environment, so "feels
right" validation on the dev server is still required by a human reviewer.
