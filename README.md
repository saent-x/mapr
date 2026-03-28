# Mapr

Open-source OSINT platform that aggregates global news from 300+ sources, scores events by severity, and visualizes them on interactive maps with intelligence analysis tools.

## Features

### Data Pipeline
- **303 News Sources** — RSS feeds, GDELT DOC 2.0 API (25 query profiles with `sourcecountry:`/`sourcelang:` operators), and HTML scrapers
- **533-City Geocoder** — Client-side geocoding covering all sovereign nations without external APIs
- **Title-Similarity Deduplication** — Jaccard token similarity (0.65 threshold) catches near-duplicates across sources
- **Modular Ingestion Pipeline** — 7-stage pipeline: fetch, normalize, enrich entities, track velocity, correlate events, persist, prune
- **Circuit Breaker** — Automatically skips failing sources after consecutive failures, resets after cooldown

### Maps & Visualization
- **Flat Map + 3D Globe** — MapLibre GL flat map (default) with on-demand Three.js globe via React.lazy
- **Geopolitical Relationship Arcs** — Country co-occurrence visualization with frequency-based coloring (cyan/amber/red)
- **Velocity Spike Markers** — Pulsing indicators on regions with anomalous activity
- **Overlay Modes** — Severity (SEV), Coverage (COV), and Geopolitical (GEO) map overlays

### OSINT Intelligence
- **Entity Relationship Graph** — Canvas force-directed graph at `/entities` showing people, organizations, and locations with co-occurrence connections
- **Multi-Factor Severity Scoring** — Keyword severity + entity significance + conflict zone boost + historical baseline + velocity
- **Source Credibility Badges** — Corroborated (2+ sources), single-source, or amplified indicators on article cards
- **Event Timeline** — Chronological timeline with lifecycle states (emerging, developing, ongoing, resolved)
- **Trend Analysis Dashboard** — SVG line/area charts showing regional activity over time at `/trends`
- **Anomaly Detection** — Velocity spike detection with z-scores and silence detection for quiet regions
- **Watch/Alert System** — Subscribe to regions, topics, or entities with localStorage persistence and toast notifications
- **Narrative Tracking** — Story evolution timeline with source diversity analysis and cross-regional spread detection
- **Saved Views** — Save and restore filter configurations with localStorage persistence
- **Briefing Export** — Generate downloadable markdown intelligence briefings

### Admin & Polish
- **Admin Dashboard** — Source health table, ingestion stats, coverage gaps at `/admin`
- **Code Splitting** — Globe and heavy components lazy-loaded, vendor-globe chunk (1.8MB) deferred until user toggles
- **Progressive List Rendering** — IntersectionObserver-based virtual scrolling for 500+ articles
- **Keyboard Navigation** — Full Tab/Enter/Escape support with visible focus indicators
- **Loading & Error States** — Skeleton loaders during fetch, error banners with retry when backend is unreachable
- **Multi-Language UI** — English, Spanish, French, Arabic (RTL), and Chinese

## Tech Stack

- **React 19** + **Vite** — Frontend with HMR
- **Zustand** — State management (3 stores: news, filter, UI)
- **react-router-dom** — Client-side routing
- **react-globe.gl** (Three.js) — 3D globe rendering (lazy loaded)
- **MapLibre GL JS** — Flat map with dark tiles
- **i18next** + **react-i18next** — Internationalization
- **date-fns** — Date formatting
- **lucide-react** — Icons
- **Express** — Backend API server
- **PostgreSQL** — Article and event persistence (Neon for production, Docker for local dev)

## Getting Started

### Prerequisites

- Node.js 18+
- Docker (for local PostgreSQL)

### Development Setup

```bash
git clone <repo-url>
cd mapr
npm install

# Start local PostgreSQL
docker run -d --name mapr-postgres \
  -e POSTGRES_USER=mapr \
  -e POSTGRES_PASSWORD=mapr \
  -e POSTGRES_DB=mapr \
  -p 5432:5432 \
  postgres:17-alpine

# Configure environment
cp .env.example .env
# Set DATABASE_URL=postgresql://mapr:mapr@localhost:5432/mapr

# Start dev server (backend on :3030, frontend on :5173)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Build for Production

```bash
npm run build
npm run preview
```

## Routes

| Route | Description |
|-------|-------------|
| `/` | Main map view with news panel, filters, and overlays |
| `/region/:iso` | Region detail with filtered articles and average severity |
| `/entities` | Entity relationship graph with type filters and "Show on Map" |
| `/trends` | Trend analysis dashboard with regional activity charts |
| `/admin` | Admin dashboard with source health and ingestion stats |

## Architecture

```
src/
├── components/
│   ├── Globe.jsx              # 3D globe (lazy loaded)
│   ├── FlatMap.jsx            # MapLibre flat map with arcs and markers
│   ├── NewsPanel.jsx          # Article list with credibility badges
│   ├── Header.jsx             # Search, language, overlay toggles
│   ├── FilterDrawer.jsx       # Severity, category, time filters
│   ├── Layout.jsx             # Navigation sidebar with routing
│   ├── MapErrorBoundary.jsx   # WebGL error recovery
│   ├── AnomalyPanel.jsx       # Velocity spike and silence alerts
│   ├── WatchlistPanel.jsx     # Watch subscriptions and counts
│   ├── NarrativePanel.jsx     # Story evolution timeline
│   ├── EventTimeline.jsx      # Chronological event timeline
│   ├── EntityRelationshipGraph.jsx  # Force-directed entity graph
│   ├── SaveViewDialog.jsx     # Save filter configuration
│   ├── DataLoadingOverlay.jsx # Loading skeleton
│   └── DataErrorBanner.jsx    # Error state with retry
├── pages/
│   ├── EntityExplorerPage.jsx # Entity explorer with graph and detail panel
│   ├── TrendAnalysisPage.jsx  # SVG trend charts
│   ├── RegionDetailPage.jsx   # Per-region article view
│   └── AdminPage.jsx          # Source health dashboard
├── stores/
│   ├── newsStore.js           # Articles, events, source health
│   ├── filterStore.js         # All filter state
│   ├── uiStore.js             # Map mode, drawer, selections
│   └── watchStore.js          # Watchlist with localStorage
├── services/
│   ├── gdeltService.js        # GDELT DOC 2.0 API (25 query profiles)
│   ├── rssService.js          # 300+ RSS feeds
│   └── backendService.js      # Backend API client
├── utils/
│   ├── geocoder.js            # 533 cities, 190+ countries
│   ├── severityModel.js       # Multi-factor severity scoring
│   ├── articleUtils.js        # Deduplication, category detection
│   ├── entityGraph.js         # Graph construction and filtering
│   ├── geopoliticalArcs.js    # Country co-occurrence arcs
│   ├── anomalyUtils.js        # Spike and silence detection
│   ├── watchUtils.js          # Watch matching logic
│   ├── narrativeHelpers.js    # Story timeline construction
│   └── briefingMarkdown.js    # Markdown report generation
├── i18n/locales/              # EN, ES, FR, AR, ZH
└── App.jsx                    # Root component (~370 lines)

server/
├── index.js                   # Express API with structured errors
├── storage.js                 # PostgreSQL persistence (Neon/local)
├── circuitBreaker.js          # Circuit breaker for source fetching
├── pipeline/
│   ├── fetchSources.js        # GDELT + RSS + HTML fetching
│   ├── normalizeArticles.js   # Merge and deduplicate
│   ├── enrichEntities.js      # NER extraction
│   ├── trackVelocity.js       # Velocity spike detection
│   ├── correlateEvents.js     # Event correlation and lifecycle
│   └── persistData.js         # Database persistence and pruning
├── entityExtractor.js         # Named entity recognition
├── entityGazetteer.js         # 200+ known entities
└── eventStore.js              # Event correlation engine
```

## Data Sources

- **GDELT Project** — Global Database of Events, Language, and Tone (DOC API v2) with 25 query profiles targeting specific regions and languages
- **RSS Feeds** — 300+ regional outlets spanning every continent and major subregion
- **HTML Scrapers** — Direct article extraction from news sites without RSS feeds
- **AFINN-165** — Sentiment lexicon for headline severity scoring (ODbL license)

## Deployment

- **Backend** — Railway (Express server)
- **Frontend** — Vercel (Vite static build)
- **Database** — Neon PostgreSQL (serverless)

## Testing

```bash
npm test          # Run all 512 tests
node --test       # Node.js native test runner
```

## License

MIT
