# Mapr deployment (Node server)

Mapr is designed to run as a **single Node.js process** that serves the API, optional SQLite-backed ingestion, SSE, and (in production) static files from `dist/`.

## Runtime

- **Node** ≥ 22
- **Start command:** `npm run start` → `node server/index.js`
- **Dev (API + Vite):** `npm run dev` — Vite proxies `/api` to `http://127.0.0.1:3030`

## Environment

See `.env.example`. Important variables:

| Variable | Purpose |
|----------|---------|
| `ADMIN_PASSWORD` | Required for admin dashboard, `/api/admin-health`, and signing sessions |
| `ADMIN_SESSION_SECRET` | Optional; defaults to `ADMIN_PASSWORD` for HMAC signing of httpOnly session cookies |
| `DATABASE_URL` / SQLite path | Used by `server/storage.js` when configured |
| `AISSTREAM_API_KEY` | Optional; enables live AIS vessel overlay |
| `VITE_MAPR_API_BASE` | **Build-time** only: set when the browser must call a **different origin** for `/api` (e.g. static site on CDN, API on another host). Default `/api` assumes same-origin or dev proxy |

## Low-cost Railway mode

For a low-budget Railway deployment, keep one Node service and one database, but stop the app from doing large background refreshes every time it wakes.

Recommended Railway variables:

```bash
MAPR_LOW_RESOURCE_MODE=1
MAPR_REFRESH_MS=5400000          # 90 min — middle ground between freshness and cost
MAPR_STALE_AFTER_MS=10800000     # 3 h — UI stops marking briefing "stale" within this window
MAPR_DB_CAPACITY_MB=1024         # match the Postgres plan (e.g. 1024 for 1 GB Hobby)
MAPR_GDELT_PROFILE_SET=core
MAPR_GDELT_PROFILE_LIMIT=4
MAPR_GDELT_MAX_RECORDS=150
MAPR_RSS_FEED_LIMIT=24
ENABLE_TRACKING=false
AISSTREAM_API_KEY=
```

`MAPR_DB_CAPACITY_MB` MUST match your Postgres plan. The trim loop fires at
90% of this value — set it too high and the DB will grow past the plan cap
before any pruning kicks in.

For the cheapest mostly-static setup, also add:

```bash
MAPR_DISABLE_AUTO_REFRESH=1
MAPR_SKIP_INITIAL_REFRESH=1
```

With those two flags enabled, the server serves the last persisted snapshot and only refreshes when an admin/client calls `POST /api/refresh`.

Railway-specific notes:

- Keep `sleepApplication` enabled for the web service.
- Use Railway private networking for the app-to-Postgres connection by setting `DATABASE_URL` from the Postgres service, not the public URL.
- If Postgres is still the main cost, move the database to a free/low-cost serverless Postgres provider and point `DATABASE_URL` at it, or export the latest snapshot and run without scheduled refreshes.

### Optional Postgres tuning

Manual `VACUUM` was removed from the trim loop in `server/storage.js` —
autovacuum handles dead-tuple reclaim instead. Under high churn (large
ingest cycles), bias autovacuum to run sooner on the hot tables:

```sql
ALTER TABLE articles SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE event_articles SET (autovacuum_vacuum_scale_factor = 0.05);
```

Run once via `psql $DATABASE_URL`. Default scale factor is 0.2 (20%
dead-tuple ratio before vacuum); 0.05 (5%) keeps `pg_database_size`
closer to actual on-disk usage so the trim cap fires on time.

## Production static assets

1. `npm run build` — outputs Vite app to `dist/`
2. Serve `dist/` with any static host **and** reverse-proxy `/api` (and `/api/stream` for SSE) to the Node server, **or** extend `server/index.js` to `fs.createReadStream` + MIME for `dist/` (not included by default).

## SSE and cookies

- EventSource uses the same origin as the app when `VITE_MAPR_API_BASE` is relative.
- Admin login sets an **httpOnly** cookie via `POST /api/admin/session` with `credentials: 'include'`.

## Legacy

- `POST /api/admin-auth` remains as a JSON-only password check (no cookie) for simple API clients.
