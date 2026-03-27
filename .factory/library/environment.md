# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Required Environment Variables

- `DATABASE_URL` - Neon PostgreSQL connection string (required for backend)
- `ADMIN_PASSWORD` - Password for admin health endpoint (optional)
- `PORT` - Backend port override (default: 3030, Railway sets automatically)
- `MAPR_REFRESH_MS` - Refresh interval in ms (default: 600000 = 10 min)
- `MAPR_STALE_AFTER_MS` - Snapshot stale threshold (default: 1800000 = 30 min)
- `MAPR_SKIP_INITIAL_REFRESH` - Set to "1" to skip startup ingest
- `MAPR_DISABLE_AUTO_REFRESH` - Set to "1" to disable scheduled refresh
- `VITE_MAPR_API_BASE` - Frontend API base URL (default: /api, override for Vercel→Railway)

## External Dependencies (No API Keys Required)

- **GDELT DOC 2.0 API** - Free, no auth. Rate limited (~5s between requests). Max 250 records per query. Searches rolling 3 months. Supports `sourcecountry:`, `sourcelang:`, `theme:` operators.
- **RSS Feeds** - ~130+ feeds, fetched directly (server-side) or via CORS proxy (client-side). Some feeds go stale or return 404 regularly.
- **HTML Scraping** - Direct fetch with User-Agent header. JSON-LD + article tag extraction.
- **CORS Proxies** (client-side only) - corsproxy.io and allorigins.win used for browser RSS fetching.

## Database

- **Local PostgreSQL** via Docker container `mapr-postgres` on port 5432
- DATABASE_URL=postgresql://mapr:mapr@localhost:5432/mapr
- Tables: metadata, refresh_history, coverage_history, articles, events, event_articles, source_credibility, velocity_history
- Connection auto-detects local vs remote: skips SSL for localhost, uses SSL for remote hosts
- Schema auto-created on first connect via `ensureSchema()`
- To start if stopped: `docker start mapr-postgres`

## Node.js

- Requires Node.js >= 22 (currently running v24.8.0)
- Project uses ES modules (`"type": "module"` in package.json)
- Built-in test runner: `node --test`

## Deployment

- **Railway**: Backend (node server/index.js), auto-builds with Nixpacks
- **Vercel**: Frontend (vite build) + serverless API functions in /api
- Both share the same codebase; api/ handlers are used by both Vercel functions and the Railway server (via adapter)
