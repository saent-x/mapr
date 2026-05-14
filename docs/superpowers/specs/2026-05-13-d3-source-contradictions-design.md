# D3 — Source contradiction finder (design)

**Date:** 2026-05-13
**Scope:** Workstream D3 in the Mapr Pro upgrade plan.
**Builds on:** `server/sourceCredibility.js` + `SourceCredibilityPanel.jsx`.

## Why

Source Credibility Panel (D-Day-2) tells the user *who* the sources are and how often they corroborate each other historically. D3 closes the loop with *what* the sources currently disagree about: casualty counts, identities, sequencing, dates. Editors and journalists care more about this than the bias spectrum because it tells them which specific claims need second-sourcing before publication.

## Architecture

A new server module `server/contradictions.js` owns the per-event LLM call. The call sends the event title + per-source headlines/summaries to `aiClient.generate` with a schema asking the model to return a list of `{ claim, supportedBy: [sourceKey], refutedBy: [sourceKey], unclear: [sourceKey] }` rows.

Cached in a new `event_contradictions` Postgres table keyed by `(eventId, lastUpdatedAt)`. Invalidation matches the brief generator's pattern — when the event row's `lastUpdatedAt` advances, the next request to the panel regenerates.

The Source Credibility Panel renders a new "Sources disagree on…" sub-section above the per-source breakdown. Each contradiction row shows the disputed fact + which sources stake which side + a confidence indicator.

## Schema

```sql
CREATE TABLE IF NOT EXISTS event_contradictions (
  "eventId"            TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  "eventLastUpdatedAt" TEXT NOT NULL,
  contradictions       TEXT NOT NULL,      -- JSON array of {claim, supportedBy[], refutedBy[], unclear[], confidence}
  "modelUsed"          TEXT,
  "generatedAt"        TEXT NOT NULL
);
```

## Routes

```
GET  /api/events/:id/contradictions   →  cached row or {contradictions: []} when none
POST /api/events/:id/contradictions   →  authed regenerate (rate-limited)
```

The GET is open (no auth) to match `/credibility`; the POST requires auth so the LLM cost is gated to logged-in users.

## JSON schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["contradictions"],
  "properties": {
    "contradictions": {
      "type": "array",
      "maxItems": 6,
      "items": {
        "type": "object",
        "required": ["claim"],
        "additionalProperties": false,
        "properties": {
          "claim":       { "type": "string", "minLength": 8, "maxLength": 280 },
          "category":    { "type": "string", "enum": ["casualties", "identity", "sequence", "location", "date", "attribution", "other"] },
          "supportedBy": { "type": "array", "items": { "type": "string" } },
          "refutedBy":   { "type": "array", "items": { "type": "string" } },
          "unclear":     { "type": "array", "items": { "type": "string" } },
          "confidence":  { "type": "string", "enum": ["high", "medium", "low"] }
        }
      }
    }
  }
}
```

Each `sourceKey` in the arrays must match a key returned by the credibility panel — server enforces this and drops invented sources.

## UI

`SourceCredibilityPanel.jsx` gains an `<EventContradictions />` sub-component rendered above the existing source list. Each contradiction is a card:

```
┌──────────────────────────────────────────────────────────┐
│ casualties · medium confidence                            │
│ Reported death count differs.                             │
│   Reuters, BBC ─── 4 confirmed dead                       │
│   AP, RIA       ─── 7 dead                                │
│   Al Jazeera    ─── figure not stated                     │
└──────────────────────────────────────────────────────────┘
```

When the cache is empty and the user is signed in, a single "Generate contradictions" button POSTs to regenerate. The result appears inline.

## Files

### New
- `server/contradictions.js`
- `server/ai/schemas/contradictions.schema.json`
- `src/components/credibility/EventContradictions.jsx`

### Modified
- `server/storage.js` — add table to `ensureSchema`.
- `server/index.js` — wire routes.
- `server/sourceCredibility.js` — include `contradictions: …` field in `buildCredibilityForEvent` so the existing UI fetches both in one round-trip.
- `src/components/SourceCredibilityPanel.jsx` — mount `EventContradictions`.
- `src/services/backendService.js` — `regenerateContradictions(eventId)`.
- `src/i18n/locales/en.json` — `contradictions.*` keys.

## Failure modes

- AI worker offline → POST returns 503 `AI_NOT_CONFIGURED`; UI shows the same "set up the sidecar" message used by Brief Generator.
- LLM returns claims referencing source keys not in the candidate set → dropped server-side.
- Single-source event → no contradictions; panel quietly omits the section.
