# Mapr

Real-time global news visualized on a 3D interactive globe. Mapr aggregates stories from 50+ news sources worldwide, scores them by severity, and plots them at their exact geographic locations.

## Features

- **3D Globe + Flat Map** — Switch between a WebGL globe (react-globe.gl) and a Leaflet flat map with marker clustering
- **50+ News Sources** — GDELT API + RSS feeds from regional outlets across Africa, Asia, Middle East, Europe, Americas, and Oceania
- **Severity Scoring** — Keyword-based severity classification (Critical, Elevated, Watch, Low) with color-coded dots
- **Category Detection** — Automatic categorization: Conflict, Weather, Seismic, Health, Humanitarian, Civil, and more
- **Client-Side Geocoding** — 280+ city database maps articles to exact coordinates without external APIs
- **Multi-Language UI** — Full i18n support for English, Spanish, French, Arabic (RTL), and Chinese
- **Expandable Articles** — Click any story to see its image, source, publish date, and a link to the full article
- **Auto-Refresh** — Live data updates every 5 minutes with manual refresh option
- **Article Deduplication** — Overlapping stories from GDELT and RSS are merged intelligently

## Tech Stack

- **React 19** + **Vite**
- **react-globe.gl** (Three.js) — 3D globe rendering
- **react-leaflet** + **Leaflet** — Flat map with CartoDB dark tiles
- **react-leaflet-cluster** — Marker clustering
- **i18next** + **react-i18next** — Internationalization
- **date-fns** — Date formatting with locale support
- **lucide-react** — Icons

## Getting Started

```bash
git clone <repo-url>
cd mapr
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
npm run build
npm run preview
```

## Architecture

```
src/
├── components/
│   ├── Globe.jsx          # 3D globe with country polygons and article dots
│   ├── FlatMap.jsx        # Leaflet map with clustered markers
│   ├── NewsPanel.jsx      # Region news list with expandable articles
│   ├── Header.jsx         # Search, language switcher, stats
│   └── FilterDrawer.jsx   # Time range, sort, severity filters
├── services/
│   ├── gdeltService.js    # GDELT DOC API integration
│   └── rssService.js      # 50+ RSS feeds with batched CORS proxy fetching
├── utils/
│   ├── geocoder.js        # Client-side geocoding (280+ cities, 100+ countries)
│   ├── articleUtils.js    # Severity scoring, category detection, deduplication
│   └── mockData.js        # Fallback data and severity metadata
├── i18n/
│   ├── index.js           # i18next configuration
│   └── locales/           # EN, ES, FR, AR, ZH translations
└── App.jsx                # Main app with data loading and state management
```

## Data Sources

- **GDELT Project** — Global Database of Events, Language, and Tone (DOC API v2)
- **RSS Feeds** — Regional outlets including Punch Nigeria, NDTV India, Japan Times, Guardian UK, Dawn Pakistan, ABC Australia, and 45+ more

## License

MIT
