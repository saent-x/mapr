# Architecture

Architectural decisions, patterns, and conventions discovered in the codebase.

**What belongs here:** Code patterns, module boundaries, naming conventions, data flow documentation.

---

## Project Structure

```
mapr/
├── api/                    # Vercel serverless functions (also used by Railway via adapter)
│   ├── _lib/               # Shared API utilities
│   ├── admin-auth.js       # Admin authentication
│   ├── admin-health.js     # Admin health endpoint
│   ├── briefing.js         # Briefing endpoint
│   ├── coverage-*.js       # Coverage endpoints
│   ├── gdelt-proxy.js      # GDELT proxy for client-side fetching
│   ├── health.js           # Health check
│   ├── refresh.js          # Manual refresh trigger
│   ├── region-briefing.js  # Region-specific briefing
│   └── source-catalog.js   # Source catalog management
├── server/                 # Railway backend (long-running Node.js server)
│   ├── index.js            # HTTP server, routes, lifecycle
│   ├── ingest.js           # Main ingestion pipeline (~500 lines, monolithic)
│   ├── storage.js          # PostgreSQL storage layer (Neon)
│   ├── entityExtractor.js  # NER using compromise.js + gazetteer
│   ├── entityGazetteer.js  # Curated organization gazetteer
│   ├── eventStore.js       # Event merging and aggregation
│   ├── htmlSourceParser.js # HTML article extraction (JSON-LD + article tags)
│   ├── rssParser.js        # RSS/Atom feed parser
│   ├── sourceCandidates.js # Candidate sources for expansion
│   ├── sourceCatalog.js    # Source catalog management
│   ├── sourceCatalogStore.js # Source catalog persistence
│   ├── sourceFetcher.js    # Unified source fetcher (RSS + HTML)
│   └── velocityTracker.js  # Article velocity spike detection
├── src/                    # React frontend
│   ├── App.jsx             # Main app (~968 lines, all state management here)
│   ├── components/         # UI components
│   ├── hooks/              # Custom hooks (useEventData)
│   ├── i18n/               # Internationalization
│   ├── pages/              # Page components (minimal)
│   ├── services/           # API clients (gdeltService, rssService, backendService)
│   └── utils/              # Utility functions (geocoder, articleUtils, etc.)
├── test/                   # Unit tests (26 files, 108 passing)
├── data/                   # SQLite DB (legacy) + source candidates JSON
└── scripts/                # Dev scripts
```

## Data Flow

1. **Ingestion** (server/ingest.js):
   - Fetches GDELT articles + RSS feeds in parallel
   - Merges GDELT + RSS articles, deduplicates
   - Runs NER on articles (extractEntities)
   - Canonicalizes articles into events (grouping by topic/location)
   - Persists articles and events to PostgreSQL
   - Computes velocity spikes, source credibility, coverage metrics
   - Stores snapshot in metadata table

2. **API Serving** (server/index.js):
   - GET /api/briefing - Returns full snapshot (articles, events, health)
   - GET /api/events - Returns events subset
   - GET /api/health - Returns operational health
   - GET /api/region-briefing?iso=XX - Region-specific data with backfill
   - POST /api/refresh - Triggers manual ingest

3. **Frontend** (src/App.jsx + hooks/useEventData.js):
   - Fetches /api/briefing on load
   - 3-tier fallback: backend → client-side GDELT → mock data
   - Auto-refresh every 5 minutes
   - Renders articles as dots on globe/flat map
   - NewsPanel shows article list for selected region

## Key Patterns

- **Shared utilities**: src/utils/ is used by BOTH frontend and backend (geocoder, articleUtils, etc.)
- **Vercel adapter**: server/index.js wraps api/ handlers with `runVercelHandler()` to share code
- **Source catalog**: RSS feeds defined in src/services/rssService.js, merged with candidates
- **Event model**: Articles → Events (1:many via event_articles junction table)
- **Coverage tracking**: Snapshots of coverage metrics stored as time series
- **Severity scoring**: Keyword-based + AFINN-165 sentiment + composite model

## Conventions

- All files use ES modules (import/export)
- No TypeScript (plain JSX/JS)
- CSS in single index.css file (~74K lines)
- React functional components only, no class components
- No state management library (all useState in App.jsx)
- i18n via i18next with EN, ES, FR, AR, ZH locales
- Date handling via date-fns
- Icons via lucide-react
