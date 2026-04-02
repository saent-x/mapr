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

## Production static assets

1. `npm run build` — outputs Vite app to `dist/`
2. Serve `dist/` with any static host **and** reverse-proxy `/api` (and `/api/stream` for SSE) to the Node server, **or** extend `server/index.js` to `fs.createReadStream` + MIME for `dist/` (not included by default).

## SSE and cookies

- EventSource uses the same origin as the app when `VITE_MAPR_API_BASE` is relative.
- Admin login sets an **httpOnly** cookie via `POST /api/admin/session` with `credentials: 'include'`.

## Legacy

- `POST /api/admin-auth` remains as a JSON-only password check (no cookie) for simple API clients.
