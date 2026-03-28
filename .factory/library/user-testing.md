# User Testing

Testing surface, required testing skills/tools, resource cost classification per surface.

---

## Validation Surface

### Web Browser (Primary)
- **URL**: http://localhost:5173
- **Tool**: `agent-browser`
- **Setup**: Run `npm run dev` (starts backend on 3030 + Vite on 5173)
- **Auth**: None required for main app. Admin endpoints need ADMIN_PASSWORD header.

### Backend API
- **URL**: http://localhost:3030/api/*
- **Tool**: curl
- **Startup**: `node --env-file=.env server/index.js` for backend-only testing, or `npm run dev` to launch backend + Vite together
- **Key endpoints to test**:
  - GET /api/health - Server health
  - GET /api/briefing - Full data snapshot
  - GET /api/events - Events list
  - GET /api/region-briefing?iso=XX - Region data
  - POST /api/refresh - Trigger ingestion
  - GET /api/source-catalog/state - Source catalog

### Known Limitations
- **3D Globe (react-globe.gl)**: Uses WebGL/Three.js. Browser automation may not be able to interact with 3D elements directly. Test globe rendering (no errors) but use flat map mode for interaction testing.
- **Flat map (MapLibre GL)**: The flat-map surface also depends on WebGL. In headless Chrome it can fail to render markers/popups reliably, so map-centric validations should prefer indirect flows (search/ticker → panel) or API evidence unless a headed browser is available.
- **Canvas visualizations**: Canvas-only UI (for example the entity relationship graph) does not expose semantic DOM nodes for individual marks. agent-browser checks may need coordinate-based clicks or DOM/eval-assisted inspection instead of standard locator-based interaction.
- **Ingestion timing**: Backend ingestion takes 1-2 minutes. Validators must wait for ingestion to complete before checking data freshness.
- **Backend env loading**: `node server/index.js` alone does not load `.env`; use `node --env-file=.env server/index.js` or `npm run dev`.
- **Backend bootstrap refresh**: After a cold backend start, `/api/health` may report `refreshInProgress: true` and `status: "stale"` for several minutes while the server still serves the last successful snapshot. Read-only validators can use that snapshot for non-freshness assertions, but should avoid starting a second refresh while bootstrap is active.
- **Local PostgreSQL**: Mission runs against local PostgreSQL (`mapr-postgres` on `localhost:5432`) via `DATABASE_URL` from `.env`.

## Validation Concurrency

### agent-browser
- Machine: 24GB RAM, 12 CPU cores
- Baseline usage: ~8GB
- Usable headroom: (24-8) * 0.7 = **11.2GB**
- Per-instance cost: ~300MB (browser) + ~200MB shared (dev server)
- **Max concurrent validators: 5**
- Rationale: 5 * 300MB + 200MB = 1.7GB, well within 11.2GB budget. CPU is not the bottleneck.

### curl (API testing)
- Negligible resource cost
- **Max concurrent: 5** (matches browser for simplicity)
- **Shared-state caveat**: flows that call `POST /api/refresh` mutate the global cached snapshot and DB-backed history, so only one such validator should run at a time.

## Flow Validator Guidance: Backend API

- Treat `POST /api/refresh` as an exclusive operation. Do not run multiple refresh requests concurrently.
- Assertions that depend on refreshed data (such as `/api/briefing` freshness) should be grouped into the same validator that triggered refresh.
- Stay within local surfaces only: `http://localhost:3030/api/*` for API checks and local server logs if needed for evidence.
- Use the shared local PostgreSQL instance configured by `.env`; do not modify `.env` or point the app at a different database.

## Flow Validator Guidance: Web Browser

- Use the assigned isolated browser session only (for this run: `62241cfc00e4__u1`, `62241cfc00e4__u2`, or another explicitly assigned session). Do not use the default browser session.
- Stay on the local validation surface at `http://localhost:5173` and its proxied local API calls; do not open unrelated external sites.
- Do not trigger manual refreshes or any other mutation-heavy backend actions during frontend-refactor validation. Validate against the currently served snapshot, even if `/api/health` reports `refreshInProgress: true`.
- Prefer flat-map interactions for filters and region selection because the 3D globe is difficult to drive reliably in automation; only verify globe mode renders and does not throw console errors.
- Keep evidence within the assigned mission evidence directory, and close the browser session before finishing the flow report.
