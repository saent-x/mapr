# D4 — Narrative arc auto-discovery (design)

**Date:** 2026-05-14
**Scope:** Workstream D4 in the Mapr Pro upgrade plan.

## Why

Story Threads (D1-Day-1 in our plan) let *one* user pin *one* event and watch follow-ups collate. D4 generalizes that pattern across the entire corpus: a background worker clusters recent events into named multi-week arcs ("Suweida Druze violence Jul-Aug 2026", "Houthi Red Sea campaign 2025-now") so every analyst sees them without doing any pinning. Each event lands tagged with the arcs it belongs to; a new `/arcs` nav surface lets you browse them like topical landing pages.

## Architecture

A single new module `server/narrativeArcs.js` owns the entire workflow:

1. **Pull** all active events from the last 30 days.
2. **Average article embeddings** per event to derive a per-event vector (events.centroid isn't on main yet; we compute on-demand from `articles.embedding`).
3. **Greedy cluster:** sort events by recency; for each event, place it into the first existing cluster whose centroid cosine ≥ 0.65 AND that shares ≥ 1 named entity; otherwise start a new cluster.
4. **Keep only durable clusters:** ≥ 5 events AND span ≥ 7 days between first and last.
5. **LLM-name each cluster:** send the top 5 event titles + most-frequent entities → `aiClient.generate` with a strict `{ name, summary, status, suggestedTags[] }` schema.
6. **Persist** `narrative_arcs` + `narrative_arc_events`. Update existing arcs by appending new events instead of duplicating.

Scheduler runs every 6 hours via `setInterval` (no BullMQ; keeps infrastructure thin, matches the daily-digest pattern). Env-gated: `DISABLE_ARC_REFRESH=true` turns it off; AI unconfigured = silent skip.

A `POST /api/admin/arcs/refresh` admin route triggers an immediate sweep for QA.

## Schema

```sql
CREATE TABLE IF NOT EXISTS narrative_arcs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  summary       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',   -- active | dormant | archived
  "firstSeenAt" TEXT NOT NULL,
  "lastUpdatedAt" TEXT NOT NULL,
  "eventCount"  INTEGER NOT NULL DEFAULT 0,
  "modelUsed"   TEXT,
  "createdAt"   TEXT NOT NULL DEFAULT (now()::text)
);

CREATE INDEX IF NOT EXISTS idx_narrative_arcs_status_recent
  ON narrative_arcs (status, "lastUpdatedAt" DESC);

CREATE TABLE IF NOT EXISTS narrative_arc_events (
  "arcId"     TEXT NOT NULL REFERENCES narrative_arcs(id) ON DELETE CASCADE,
  "eventId"   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  "addedAt"   TEXT NOT NULL,
  relevance   REAL,
  PRIMARY KEY ("arcId", "eventId")
);

CREATE INDEX IF NOT EXISTS idx_narrative_arc_events_event
  ON narrative_arc_events ("eventId");
```

## Routes

- `GET /api/arcs` — list active arcs sorted by `lastUpdatedAt`. Query: `?limit=20&status=active`.
- `GET /api/arcs/:id` — single arc + its 50 most recent linked events.
- `GET /api/events/:id/arcs` — arcs an event belongs to (for inline tags on event detail).
- `POST /api/admin/arcs/refresh` — admin trigger.

## UI

1. **`/arcs` page** (new). Card list: name, 2-sentence summary, event count, last-updated. Each card links to `/arcs/:id`.
2. **`/arcs/:id` page** (new). Header (name + summary + status pill) + chronological event list with severity / region badges and links to `/event/:id`.
3. **Arc tag on event detail** — a small "Part of: [arc name] · [arc name]" line under the existing pill row, linking to each arc's landing page.
4. **Nav entry** in `Layout.jsx`: "Arcs" link, alongside Trends / Entities. Icon: `Layers` or `GitBranch`.

## Files

### New
- `server/narrativeArcs.js`
- `server/ai/schemas/narrativeArc.schema.json`
- `src/pages/ArcsPage.jsx`
- `src/pages/ArcDetailPage.jsx`
- `src/components/EventArcTags.jsx`
- `test/narrativeArcs.test.js`

### Modified
- `server/storage.js` — add tables to `ensureSchema`.
- `server/index.js` — register routes + start the 6-hour sweep on boot.
- `src/main.jsx` — add `/arcs` + `/arcs/:id` routes.
- `src/components/Layout.jsx` — sidebar nav entry.
- `src/pages/EventDetailPage.jsx` — mount `<EventArcTags />` below the pill row.
- `src/services/backendService.js` — `fetchArcs`, `fetchArc`, `fetchEventArcs`.
- `src/i18n/locales/en.json` — `arcs.*` keys.
- `src/index.css` — arc page + tags + cards.
- `src/utils/featureAccess.js` — add `narrativeArcs` row (free tier).

## Out of scope

- User-pinning of arcs into a personal feed (separate follow-up).
- Email digest of "new arc detected" (small follow-up).
- Cross-language clustering nuance — bge-m3 is multilingual so we get it free, but no tuning here.
