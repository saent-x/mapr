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
- **Key endpoints to test**:
  - GET /api/health - Server health
  - GET /api/briefing - Full data snapshot
  - GET /api/events - Events list
  - GET /api/region-briefing?iso=XX - Region data
  - POST /api/refresh - Trigger ingestion
  - GET /api/source-catalog/state - Source catalog

### Known Limitations
- **3D Globe (react-globe.gl)**: Uses WebGL/Three.js. Browser automation may not be able to interact with 3D elements directly. Test globe rendering (no errors) but use flat map mode for interaction testing.
- **Ingestion timing**: Backend ingestion takes 1-2 minutes. Validators must wait for ingestion to complete before checking data freshness.
- **Remote DB only**: No local database. Tests that check persisted data rely on the Neon PostgreSQL connection.

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
