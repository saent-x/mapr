# Mapr Pro: Intelligence-First OSINT Upgrade

## Overview

Transform Mapr from a news-mapping dashboard into a professional OSINT analysis tool for solo analysts. Four phases, each building on the last. All free-tier compatible (Vercel free, SQLite, client-side processing, no paid APIs).

**Target user:** Solo OSINT analyst using Mapr as a daily driver to monitor global events.

**Approach:** Intelligence-First — build the data model foundation first, then layer intelligence, workflows, and meta-analysis on top.

**Constraints:** Free-tier only. No paid APIs, no hosted databases. compromise.js for NER (runs in Node), SQLite for server persistence, IndexedDB + localStorage for client persistence.

---

## Phase 1: Event Engine

**Goal:** Replace ephemeral articles with persistent events that accumulate evidence over time.

### Problem

Articles are currently independent, ephemeral data points. Each 5-minute refresh replaces the entire article set. There is no concept of "the Turkey earthquake" as a persistent object — just 14 disconnected article dots that happen to share keywords. Deduplication runs within a single fetch cycle but has no memory across cycles. An analyst cannot track a developing situation because the tool forgets everything on refresh.

### Solution

Introduce a canonical event store where articles become evidence attached to persistent events with stable IDs and lifecycle states.

### Event Data Model

```
Event {
  id: string              // stable hash — see "Event ID Generation" below
  title: string            // most representative headline from cluster
  countries: string[]      // all ISO codes mentioned across articles
  primaryCountry: string   // highest-mentioned ISO code
  topicFingerprint: string // normalized token set from representative headline (used for ID)
  lifecycle: enum          // 'emerging' | 'developing' | 'escalating' | 'stabilizing' | 'resolved'
  severity: number         // 0-100, composite score
  articleCount: number     // how many sources are reporting this
  sourceTypes: Set         // { 'wire', 'state', 'independent', 'ngo' }
  articles: Article[]      // all evidence articles, ordered by relevance
  firstSeenAt: Date        // when the event was first detected
  lastUpdatedAt: Date      // most recent article timestamp
  coordinates: [lat, lng]  // best available geocode
  category: string         // 'conflict' | 'disaster' | 'political' | 'humanitarian' | 'economic'
}
```

### Event ID Generation

The event ID must be stable across refreshes so the same real-world event keeps the same ID.

**Algorithm:**
1. Take the event's `primaryCountry` ISO code
2. Compute the `topicFingerprint`: tokenize the representative headline (using existing `tokenizeHeadline` from newsPipeline.js), sort tokens alphabetically, take the top 5 by frequency across all clustered articles
3. Hash: `sha256(primaryCountry + ":" + sortedTopTokens.join(","))` truncated to 16 hex chars

**No time window in the ID.** Instead, events are matched by similarity to existing events in the store (see Clustering Algorithm). This avoids the boundary problem where an event at hour 47 of a 48h window would get a new ID. Events naturally expire via the lifecycle system (resolved after 24h of no new articles, pruned after 30 days).

**ID stability:** if a new article merges into an existing event and changes the top tokens, the ID does NOT change — it was set at creation time. Only `topicFingerprint` updates for display/search purposes.

### Clustering Algorithm

Runs server-side during each ingest cycle. Merges new articles into existing events or creates new ones.

For each new article:
1. Tokenize headline using `tokenizeHeadline` (already in newsPipeline.js)
2. Compare against all non-resolved events from the last 72 hours in the events table
3. Compute Jaccard similarity between the article's tokens and each event's `topicFingerprint` tokens
4. Match criteria: Jaccard >= 0.3 AND shares >= 1 country ISO code
5. If multiple events match, pick the one with the highest Jaccard score
6. If match: merge article into existing event, update `lastUpdatedAt`, recompute severity and lifecycle
7. If no match: create new event with lifecycle = 'emerging', generate stable ID from step 1-3 of ID generation

### Lifecycle Transitions

Computed per event each ingest cycle. Rules are evaluated in priority order — first match wins:

1. **resolved**: no new articles in 24h (highest priority — overrides everything)
2. **escalating**: articleCount increased by 50%+ in the last 2 hours compared to the previous 2-hour window
3. **stabilizing**: was previously 'escalating' or 'developing', and no new articles in 6h
4. **developing**: 3+ sources OR event age > 2h
5. **emerging**: default state for new events (fewer than 3 sources AND first seen < 2h ago)

### Storage

**Server (SQLite):**

Currently, storage.js has no `articles` table — the entire snapshot is stored as a JSON blob in the `metadata` table. Phase 1 must add individual article persistence before events can reference them.

New tables:
- `articles` — individual article records with id, title, url, source, publishedAt, region, coordinates, severity, geocodePrecision. Deduplicated by URL.
- `events` — event records with id, title, primaryCountry, lifecycle, severity, category, firstSeenAt, lastUpdatedAt, topicFingerprint, coordinates.
- `event_articles` — junction table (eventId, articleId) linking articles to events.

The existing `metadata` table (snapshot JSON blob) is kept for backward compatibility during migration but is no longer the primary data store. Events persist across server restarts. Prune resolved events older than 30 days. Prune orphaned articles (not linked to any event) older than 7 days.

**Client (IndexedDB):**
- Cache last-seen events for offline access and diff computation
- Enable "what changed since last visit" (Phase 3)
- Store event snapshots for timeline scrubbing (Phase 3)
- Auto-prune entries older than 7 days

### UI Impact

- Globe/FlatMap: dots represent events, not articles. Size = source count. Color = severity.
- NewsPanel: shows event cards. Expand to see all source articles as evidence.
- Arcs: connect events that share countries, not just articles with word overlap.
- Intel ticker: shows event lifecycle changes ("Sudan conflict → escalating, 8 sources").
- New lifecycle badge on event cards: colored pill showing emerging/escalating/etc.

### Files Changed

- **NEW** `server/eventStore.js` — event CRUD, clustering, lifecycle transitions
- **NEW** `src/utils/eventModel.js` — shared event types, ID generation (uses Node built-in `crypto.createHash('sha256')`), lifecycle logic
- **MOD** `src/utils/newsPipeline.js` — export `tokenizeHeadline` and `jaccardSimilarity` (currently private, needed by eventStore.js)
- **MOD** `server/storage.js` — add articles, events, and event_articles tables
- **MOD** `server/ingest.js` — call event clustering after article ingestion (imports from `src/utils/` as it already does today)
- **MOD** `api/briefing.js` — return events instead of raw articles
- **MOD** `src/App.jsx` — consume events, derive filtered/sorted event lists
- **MOD** `src/components/Globe.jsx` — render events as dots, size by source count
- **MOD** `src/components/FlatMap.jsx` — same as Globe
- **MOD** `src/components/NewsPanel.jsx` — event cards with expandable source list
- **MOD** `src/components/ArcPanel.jsx` — event-based arcs

### Backward Compatibility

The briefing API still returns articles inside events, so client components that expect articles can still access them. The event is a wrapper, not a replacement. Migration path: components read from `event.articles` instead of the top-level articles array.

---

## Phase 2: Entity Intelligence

**Goal:** Extract actors, organizations, and locations from every article. Make arcs and severity meaningful.

### Problem

Severity scoring uses a hand-curated keyword list (80 English terms, 30 non-English) plus AFINN-165 sentiment (English-only). This means: (1) non-English articles are systematically under-scored, (2) severity cannot distinguish "earthquake kills 500" from "earthquake drill planned," (3) arcs between countries are based on headline word overlap, not actual relationships, (4) there's no way to search "show me everything about Wagner Group."

### NER Pipeline: compromise.js

compromise.js (200KB, runs in Node, no GPU, no API calls) handles English natively. For non-English headlines, we extract proper nouns via capitalization patterns plus a supplementary gazetteer.

```
Input: "Wagner Group fighters deployed to Mali amid UN withdrawal"

compromise.people()        → []
compromise.organizations() → ["Wagner Group", "UN"]
compromise.places()        → ["Mali"]
custom.eventType()         → "military_deployment"

Output: {
  people: [],
  organizations: ["Wagner Group", "UN"],
  locations: ["Mali"],
  eventType: "military_deployment",
  relationHint: "deployment_to"
}
```

### Entity-Enriched Event Model

Added to the Event from Phase 1:

```
entities: {
  people: [{ name, mentionCount, roles }],
  organizations: [{ name, mentionCount, type }],
  locations: [{ name, iso, coordinates }]
}
// Note: `category` from Phase 1 is retained and now populated by NER-derived
// event type classification instead of keyword heuristics. No new `eventType`
// field — Phase 2 improves the existing `category` field's accuracy.
confidence: number    // 0-1, composite of source diversity + credibility + corroboration
sourceProfile: {
  wireCount: number,
  independentCount: number,
  stateMediaCount: number,
  ngoCount: number,
  diversityScore: number  // 0-1
}
```

### Composite Severity Scoring

Replace the pure keyword approach with a weighted composite:

| Signal | Weight | Description |
|--------|--------|-------------|
| keywordBase | 30% | Existing keyword match, kept as baseline |
| sourceCorroboration | 30% | log2(articleCount) × diversityScore |
| entitySignal | 20% | known high-impact actors (military, rebel groups) boost score |
| eventTypeWeight | 20% | conflict/disaster weighted higher than political/economic |

**Phase 4 upgrade:** when velocity tracking is available (Phase 4), the weights redistribute to include a `velocitySignal` (20%), with sourceCorroboration and eventTypeWeight each dropping by 10%. Until then, the 4-signal model above is used. The severity model checks for the presence of velocity data and adjusts weights accordingly.

An event with 8 diverse sources saying "situation developing" now outranks a single source saying "crisis."

### Smart Arc Types

Three distinct arc types replace the current headline-word-overlap approach:

1. **Shared Actor** — same entity (person, org) active in events in different countries. Example: Wagner Group in Mali and Libya. Arc labeled with the shared entity name. Detection: entity name string match across events in different countries.

2. **Causal Flow** — two events in different countries where category pairs suggest cause-effect AND they overlap temporally (within 72h). Detection uses a hardcoded relationship table:

   | Source category | Target category | Relationship label |
   |---|---|---|
   | disaster | humanitarian | "displacement" |
   | conflict | humanitarian | "refugee flow" |
   | conflict | political | "diplomatic response" |
   | economic | political | "economic pressure" |
   | political | conflict | "escalation" |

   Both events must share at least one entity (org or location reference) OR be in geographically adjacent countries (adjacency data added to `src/utils/geocoder.js` as a `COUNTRY_ADJACENCY` map — ~200 country pairs). This prevents false connections like "earthquake in Chile" → "refugees in Syria."

3. **Same Event** — a single event whose `countries` array contains 2+ ISO codes. No cross-event matching needed — this is intrinsic to the event model. Arc connects the countries within a multi-country event.

Arc thickness = event severity. Arc color = arc type (cyan = shared actor, amber = causal flow, white = same event). Hovering shows shared context in ArcPanel.

### Source Credibility

Extend `sourceMetadata.js` with a dynamic credibility layer:

- **Static tier** (already exists): wire > independent > state > unknown
- **Dynamic tier** (new): track per-source corroboration rate over time. Sources whose articles consistently cluster with wire service coverage gain trust. Sources that are frequently the sole reporter for events that no one corroborates lose trust.
- **Amplification flag**: when 5+ articles from the same source network arrive within 30 minutes with Jaccard >= 0.7, flag as "coordinated" rather than "corroborated."
- Event `confidence` = f(source diversity, credibility scores, corroboration pattern)

### Non-English Handling

- **Latin scripts (French, Spanish):** extract capitalized multi-word sequences as potential entities
- **Arabic/Chinese:** curated gazetteer of ~200 high-frequency OSINT actors (heads of state, military groups, international orgs). Match against article text.
- **Pragmatic tradeoff:** English NER is deep, non-English is shallow but better than nothing. Non-English coverage improves iteratively as the gazetteer grows.

### Files Changed

- **NEW** `server/entityExtractor.js` — compromise.js NER + gazetteer + event type classification
- **NEW** `server/entityGazetteer.js` — curated list of ~200 high-frequency OSINT actors/orgs
- **NEW** `src/utils/severityModel.js` — composite severity scoring (lives in `src/utils/` so both server and client can import, following existing pattern)
- **NEW** `src/utils/amplificationDetector.js` — source network clustering + coordination detection (used by server in Phase 2, UI added in Phase 4)
- **MOD** `server/eventStore.js` — enrich events with entities + confidence + source profile
- **MOD** `server/ingest.js` — run NER during ingestion pipeline
- **MOD** `src/utils/articleUtils.js` — deriveSeverity delegates to new composite model
- **MOD** `src/utils/sourceMetadata.js` — dynamic credibility scoring (amplification logic lives in amplificationDetector.js)
- **MOD** `src/utils/geocoder.js` — add `COUNTRY_ADJACENCY` map for causal flow arc detection
- **MOD** `src/components/ArcPanel.jsx` — show arc type labels, entity context
- **MOD** `src/components/NewsPanel.jsx` — show entity tags on event cards
- **MOD** `src/components/Globe.jsx` — arc color by type
- **MOD** `src/components/FlatMap.jsx` — arc color by type

---

## Phase 3: Analyst Workspace

**Goal:** Session memory, saved views, change tracking, and briefing export. Turn Mapr into a daily driver.

### Problem

Every visit starts from scratch. There's no way to save "I'm watching the Sahel situation," no idea what changed since yesterday, and no way to share findings. All filter state lives as ephemeral useState calls in App.jsx with no persistence. This makes the tool unsuitable for any workflow longer than a glance.

### Feature 1: Session Memory

IndexedDB stores event snapshots on each visit. When the analyst returns, Mapr diffs current events against the last snapshot.

- **On load:** read last snapshot from IndexedDB, compare with fresh server data
- **New events:** badge in header ("4 new events since 6h ago"), highlighted with subtle glow on map
- **Escalated:** events that changed lifecycle (developing → escalating), shown in "Changes" section at top of NewsPanel
- **Resolved:** events that moved to resolved since last visit, collapsed section
- **Persist:** save current snapshot to IndexedDB, auto-prune snapshots older than 7 days

### Feature 2: Saved Situation Views

A "view" is a saved combination of all filter and map state, stored in localStorage.

```
SavedView {
  id: string,
  name: string,              // "Sahel Instability Watch"
  filters: {
    searchQuery, dateWindow, minSeverity, minConfidence,
    sortMode, selectedRegion, categories, entityFilter
  },
  mapState: {
    mapMode, mapOverlay, center, zoom
  },
  pinnedEventIds: string[],  // events manually pinned to this view
  createdAt: Date,
  lastOpenedAt: Date
}
```

UI: compact dropdown in the navbar showing saved views with a colored dot per view. "+" button to save current state as a new view.

### Feature 3: Event Timeline

Horizontal timeline scrubber at the bottom of the map. Shows event density over time with lifecycle color coding (emerging = cyan, developing = green, stabilizing = amber, escalating = red).

- Drag playhead to scrub through the last 7 days
- Map updates to show events as they existed at that point in time
- Click a density bar to jump to that moment
- Data sourced from IndexedDB event snapshots

### Feature 4: Briefing Export

- **PDF:** generate a styled briefing document from the current view using browser print-to-PDF (no library). Includes situation summary, top events by severity, lifecycle changes, entity mentions, coverage notes.
- **JSON Snapshot:** export raw event data as a timestamped JSON file. Importable by another Mapr instance or usable for offline analysis.

### Feature 5: URL State Encoding

All filter + map state encoded in URL query params:

```
mapr.app/?region=ML&severity=60&entity=Wagner&mode=flat
```

- Deep links: share a URL, recipient sees your exact view
- Browser history: back button returns to previous view state
- Uses react-router-dom (already a dependency)

### Files Changed

- **NEW** `src/services/eventCache.js` — IndexedDB event snapshot storage + diff engine
- **NEW** `src/utils/viewManager.js` — saved view CRUD, localStorage persistence, URL encoding
- **NEW** `src/components/ViewSwitcher.jsx` — navbar dropdown for saved views
- **NEW** `src/components/EventTimeline.jsx` — horizontal timeline scrubber component
- **NEW** `src/components/ChangesBanner.jsx` — "4 new events since 6h ago" + lifecycle changes
- **NEW** `src/components/BriefingExport.jsx` — PDF/JSON export dialog
- **MOD** `src/App.jsx` — integrate view manager, URL state sync, change detection
- **MOD** `src/components/Header.jsx` — view switcher + new events badge + export button
- **MOD** `src/components/NewsPanel.jsx` — "Changes since last visit" section at top
- **MOD** `src/main.jsx` — URL param routing for view state

---

## Phase 4: Coverage Intelligence

**Goal:** Surface what you're NOT seeing and what's suspicious. The meta-analysis layer.

### Problem

The most dangerous failure of an OSINT tool is confident ignorance — showing a calm map when a crisis is simply not being captured. Mapr already computes coverage diagnostics, source coverage audits, and ops alerts, but all of this is buried in the admin health dashboard. The analyst sees events but has no idea which regions are under-covered, which sources have gone dark, or whether "8 sources reporting" means real corroboration or coordinated messaging.

### Feature 1: Silence Map Overlay

A new "coverage" overlay toggle alongside the existing "severity" overlay. Countries shaded by coverage health, not event severity.

**Silence detection:**
- Compare current article count per region against its 7-day rolling average (from coverageHistory.js)
- If current count < 30% of rolling average → flag as "anomalous silence"
- If region has zero sources and GDELT reports activity → flag as "blind spot"
- Static silent countries (North Korea, Turkmenistan) get a "limited access" label, not "anomalous"

### Feature 2: Velocity Anomaly Detection

Detect breaking situations before keywords catch them by watching for article volume spikes.

Per region, each ingest cycle:
1. Count articles in last 2 hours
2. Compare to 7-day rolling average for the same 2-hour window
3. Compute z-score: `(current - mean) / stddev`
4. If z >= 2.0 → flag as "velocity spike"
5. If z >= 1.5 → flag as "elevated activity"

UI: pulsing amber ring on the map, toast notification, velocity badge on event cards, spike markers on the timeline.

### Feature 3: Amplification Warnings (UI)

The amplification detection logic is implemented in Phase 2 (Source Credibility section) as part of the server-side pipeline. Phase 4 adds the **user-facing UI** for this signal:

- Amplification badge on event cards with tooltip explaining why ("5 articles from 2 source networks in 15 minutes")
- Amplified events visually distinguished from corroborated events in severity coloring (amber tint instead of pure red)
- Filter option in FilterDrawer to show/hide amplified events

### Feature 4: Source Health Auto-Monitor

Promote useful parts of the admin health dashboard into the analyst-facing Intel tab:
- Feed status strip: "112/133 feeds healthy" with trend arrow
- Source drop alert: toast when a high-value source goes dark for 2+ cycles
- Auto-disable suggestion: feeds failing 7+ consecutive days get flagged with "disable?" action
- Coverage gap suggestions: when a region drops to sparse/silent, show candidate sources from `source-candidates.json`

### Feature 5: Region Confidence Indicator

Composite confidence score per region, rendered as an opacity gradient on the map:

| Signal | Weight | Description |
|--------|--------|-------------|
| sourceCount | 30% | How many active feeds cover this region |
| sourceDiversity | 25% | How many distinct source types |
| recency | 25% | Time since last article from this region |
| geocodePrecision | 20% | Locality vs country-level geocoding |

Low-confidence regions appear slightly faded/desaturated. Hover tooltip: "Medium confidence — 2 sources, last updated 4h ago."

### Files Changed

- **NEW** `server/velocityTracker.js` — per-region article velocity stats + z-score anomaly detection
- **NEW** `src/utils/silenceDetector.js` — compare current coverage vs rolling baseline (builds on existing `coverageDiagnostics.js` and `coverageHistory.js` data)
- **NEW** `src/utils/regionConfidence.js` — composite confidence scoring per region
- **MOD** `src/utils/amplificationDetector.js` — (created in Phase 2) no logic changes, only consumed by new UI components
- **MOD** `server/ingest.js` — run velocity tracking each cycle, include in briefing response
- **MOD** `src/App.jsx` — new "coverage" map overlay mode, velocity spike toasts
- **MOD** `src/components/Globe.jsx` — silence overlay, confidence opacity, velocity pulse rings
- **MOD** `src/components/FlatMap.jsx` — same overlays as Globe
- **MOD** `src/components/NewsPanel.jsx` — amplification badges, velocity badges on event cards
- **MOD** `src/components/FilterDrawer.jsx` — Intel tab: feed health strip, source drop alerts, gap suggestions
- **MOD** `src/components/Header.jsx` — coverage overlay toggle in legend

---

## Cross-Cutting Concerns

### App.jsx Decomposition

App.jsx is currently 789 lines with 25+ useState hooks. Each phase adds more state. To prevent this from becoming unmanageable:

- Phase 1: extract data-fetching into a `useEventData` custom hook
- Phase 2: extract entity/severity logic into server-side pipeline (reduces client complexity)
- Phase 3: extract view/filter state into `useViewManager` custom hook with URL sync
- Phase 4: extract coverage/confidence state into `useCoverageIntelligence` custom hook

This is incremental — no big-bang refactor. Each phase extracts the state it introduces.

### Testing Strategy

Each phase should include tests for its core logic:
- Phase 1: event clustering, lifecycle transitions, stable ID generation
- Phase 2: entity extraction, composite severity scoring, amplification detection
- Phase 3: event diff engine, view serialization/deserialization, URL encoding
- Phase 4: silence detection, velocity z-score, confidence scoring

Use the existing Node test runner (`node --test`). Focus on pure-function unit tests for the new utility modules.

### Performance

- NER (compromise.js) adds ~50-100ms per article during server-side ingest. Acceptable for the 10-minute refresh cycle.
- IndexedDB operations are async and non-blocking.
- Event clustering runs server-side, not client-side. Client receives pre-clustered events.
- Timeline scrubbing reads from local IndexedDB, not the server.

### Migration Path

Each phase is independently deployable. The briefing API evolves:
- Phase 1: adds `events` array to response (articles still included inside events)
- Phase 2: adds `entities`, `confidence`, `sourceProfile` to each event
- Phase 3: no API changes (all client-side)
- Phase 4: adds `velocitySpikes`, `silenceAlerts` to briefing response
