# MAPR — Active OSINT Intelligence Platform

Open-source intelligence platform that aggregates global news from 300+ sources, scores events by severity, and visualizes them on interactive maps with full intelligence analysis, i18n, and offline support.

---

## Features

### Authentication & User Management
- **InstantDB Magic Code Auth** — Passwordless email sign-in with zero config
- **User Profiles** — Auto-created on first sign-in, linked to subscriptions
- **Saved Views** — Named filter presets persisted to InstantDB per user
- **Alert Rules** — Severity-threshold notifications tied to saved views
- **Bookmarks** — Save individual stories with region and severity metadata

### UX & Accessibility
- **Keyboard Shortcuts** — Full keyboard navigation with `?` help overlay
- **Theme Support** — Light/dark mode toggle with system preference detection
- **Onboarding** — Guided first-run experience for new users
- **i18n in 5 Languages** — English, Spanish, French, Arabic (RTL), Chinese
- **Mobile-Responsive** — Touch-friendly layout with 44px minimum tap targets
- **RTL Support** — Full right-to-left layout for Arabic locale

### Intelligence & Analysis
- **Saved Views & Alert Rules** — Persist filter configurations and receive severity-based notifications
- **Watchlist** — Subscribe to regions, topics, or entities
- **Bookmarks** — Save and organize important stories
- **Data Freshness** — Real-time indicators showing article age and source recency
- **Event Correlation** — Automatic grouping of related stories into events with lifecycle tracking
- **Comparative Regions** — Side-by-side region analysis
- **Historical Queries** — Time-range queries for trend investigation
- **Entity Relationship Graph** — Force-directed canvas graph of people, organizations, and locations
- **Source Reliability** — Credibility badges (corroborated, single-source, amplified) on articles
- **Narrative Tracking** — Story evolution timeline with source diversity and cross-regional spread
- **Anomaly Detection** — Velocity spike detection with z-scores and silence detection

### Maps & Visualization
- **Flat Map (MapLibre GL)** — Default dark-tiled interactive map with severity/coverage/geopolitical overlays
- **3D Globe (Three.js)** — On-demand globe with lazy loading
- **Geopolitical Arcs** — Country co-occurrence visualization with frequency-based coloring
- **Velocity Markers** — Pulsing indicators on regions with anomalous activity
- **Overlay Modes** — Severity (SEV), Coverage (COV), and Geopolitical (GEO)

### Export & Offline
- **Briefing Export** — Generate downloadable markdown intelligence briefings
- **PDF Export** — PDF generation via jsPDF and html2canvas
- **PWA / Offline** — Service worker for offline access to cached data
- **Shareable Views** — Share filter configurations via URL
- **Coverage Drill-Down** — Per-region source coverage analysis
- **Print View** — Optimized print layout for reports

### Subscription & Admin
- **Free / Pro Tiers** — Stripe Checkout integration for subscription management
- **Admin Source Management** — Dashboard for source health, ingestion stats, and coverage gaps
- **Event Detail Pages** — Full event view with related articles and entity extraction
- **TypeScript** — Gradual TypeScript migration with type definitions

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, React Router 7 |
| State | Zustand 5 (news, filter, UI, watch stores) |
| Maps | MapLibre GL JS 5, Three.js (globe) |
| Auth & Data | InstantDB (real-time, auth, schema) |
| Payments | Stripe (Checkout, webhooks) |
| i18n | i18next, react-i18next |
| Backend | Node.js, Express |
| Database | SQLite (default), PostgreSQL (optional via pg) |
| PWA | Service Worker, Web App Manifest |
| Export | jsPDF, html2canvas |

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 22.12.0
- **npm** (or your preferred package manager)

### Install

```bash
git clone <repo-url>
cd mapr
npm install
```

### Environment Setup

Create a `.env` file in the project root with the following variables:

```bash
# InstantDB (required for auth and real-time data)
INSTANT_APP_ID=your_instant_app_id
INSTANT_ADMIN_TOKEN=your_instant_admin_token

# Stripe (required for subscription features)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...

# Database (SQLite by default; set for PostgreSQL)
DATABASE_URL=mapr.db
# DATABASE_URL=postgresql://user:pass@host:5432/mapr

# Server
PORT=3030
```

### Run Development

```bash
npm run dev
```

Starts the Vite dev server on `:5173` with the API server proxied on `:3030`.

### Run Tests

```bash
npm test
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `INSTANT_APP_ID` | Yes | InstantDB application ID |
| `INSTANT_ADMIN_TOKEN` | Yes | InstantDB admin SDK token |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret API key |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret |
| `STRIPE_PRICE_ID` | Yes | Stripe price ID for Pro subscription |
| `DATABASE_URL` | No | Database path or connection string (defaults to `mapr.db` SQLite) |
| `PORT` | No | API server port (defaults to `3030`) |

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite + API dev server with HMR |
| `npm run dev:frontend` | Start Vite frontend only |
| `npm run start` | Start production API server |
| `npm run build` | Build for production (`dist/`) |
| `npm run preview` | Preview production build locally |
| `npm test` | Run all tests (1,289+) via Node test runner |

---

## Project Structure

```
src/
├── components/       # Reusable UI components (map, panels, dialogs, modals)
├── hooks/            # Custom React hooks (auth, filters, keyboard, map, etc.)
├── i18n/             # i18next config and locale files (en, es, fr, ar, zh)
├── lib/              # Utility libraries (InstantDB client, etc.)
├── pages/            # Route pages (Admin, Billing, Entities, Events, Regions, Trends)
├── services/         # API clients (backend, GDELT, RSS)
├── stores/           # Zustand stores (news, filter, UI, watch)
├── types/            # TypeScript type definitions
├── utils/            # Pure utility functions (geocoder, severity, dedup, arcs)
├── App.jsx           # Root component and router
├── main.jsx          # Entry point
└── index.css         # Global styles

server/
├── index.js          # Express API server
├── storage.js        # Database layer (SQLite / PostgreSQL)
├── circuitBreaker.js # Source failure circuit breaker
├── pipeline/         # 7-stage ingestion pipeline (fetch, normalize, enrich, velocity, correlate, persist, prune)
└── ...               # Entity extraction, event store, gazetteer

data/                 # Static data files (entity gazetteer, etc.)
public/               # PWA manifest, icons, static assets
test/                 # Test files (1,289+ tests)
```

---

## Testing

```bash
# Run all tests
npm test

# Under the hood
node --experimental-strip-types --test
```

The test suite covers:
- Component rendering and interaction
- Store state management
- Utility functions (geocoding, severity, dedup, entity extraction)
- Server pipeline stages
- Mobile responsiveness
- i18n key coverage across all 5 locales
- **1,289+ tests total**

---

## Internationalization

| Locale | Language | Direction |
|--------|----------|-----------|
| `en` | English | LTR |
| `es` | Spanish | LTR |
| `fr` | French | LTR |
| `ar` | Arabic | RTL |
| `zh` | Chinese | LTR |

- **848 translation keys** per locale
- Full RTL layout support for Arabic
- Date formatting adapted per locale via `date-fns`
- Language switcher in the header

---

## Deployment

- **App** — Single Node process (`npm run start`) for API, ingestion, and static `dist/`
- **Dev** — `npm run dev` runs Vite + API with `/api` proxied to port 3030
- **Database** — SQLite by default in `server/storage.js`
- **Details** — See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

## License

MIT
