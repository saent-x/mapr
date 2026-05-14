# D2 — Beat-aware semantic alerts (design)

**Date:** 2026-05-13
**Scope:** Workstream D2 in the Mapr Pro upgrade plan.
**Builds on:** the `articles.embedding` column + `server/ai/client.embed()` already live.

## Why

Watchlists today rely on keyword matching, which over-matches synonyms and
misses obliquely-relevant stories. Analysts who describe their beat in
plain English ("Central Asian gas pipelines, sanctions evasion in shadow
tanker fleets") get a sharper signal because the corpus is searched on
**meaning** rather than substring. The required infrastructure —
embeddings on every article — already exists.

## Architecture

- **Postgres** stores the beat embedding (1024-dim) so the cosine query
  uses the same pgvector index as everything else. InstantDB can't store
  vectors usefully.
- **A new table `user_beat_profiles`** keyed on the InstantDB user id
  carries the description text, the embedding, the model that produced
  it, and an `updatedAt` timestamp.
- **A new server module `server/beats/`** owns three concerns: read/write
  the profile (regenerating the embedding when the description changes),
  match the user's beat against the corpus (returns top-N recent
  articles), and project beat-matches into the daily digest worker.
- **No realtime match-on-ingest job in v1.** The query is fast enough
  (HNSW + 1 vector per user) to run on-demand from the GET endpoint.
  When digests run, the worker calls the same matcher.

## Schema

```sql
CREATE TABLE IF NOT EXISTS user_beat_profiles (
  "userId"          TEXT PRIMARY KEY,
  description       TEXT NOT NULL,
  embedding         vector(1024),
  "embeddingModel"  TEXT,
  "updatedAt"       TEXT NOT NULL,
  "createdAt"       TEXT NOT NULL DEFAULT (now()::text)
);

CREATE INDEX IF NOT EXISTS idx_user_beat_profiles_updated
  ON user_beat_profiles ("updatedAt");
```

No HNSW index here — we're scanning a small table (one row per active
user, ≤thousands), not searching it; the cosine query is against
`articles.embedding`.

## Routes

```
GET  /api/me/beat            → { description, model, updatedAt } | { description: '' }
PUT  /api/me/beat            → { description } persisted + re-embedded
DELETE /api/me/beat          → 204 (drops the row)
GET  /api/me/beat/matches    → ?since=ISO&minSimilarity=0.5&limit=20
                              → [{ articleId, eventId, title, source, url,
                                    similarity, publishedAt, ... }, ...]
```

PUT triggers a synchronous `aiEmbed` call (1024-dim vector ~50ms once the
model is warm) and writes the row atomically.

GET /matches runs the cosine query live against the user's embedding +
a 7-day-by-default window + similarity threshold (default 0.5; can be
relaxed by query param).

## Tier gating

The feature ships free with limits:
- Free: 1 beat description, refresh once per 24 h, up to 50 matches/day in digest.
- Pro: unlimited refreshes, up to 200 matches/day, surfaced in alert digests.

`featureAccess.js` gets a `beatAlerts` row.

## Daily digest integration

`server/alerts/dailyDigest.js` already pulls watchlist matches. Add a
parallel step: for users with a beat profile, run the beat matcher for
the last 24 h and merge the results into the digest under a new
"From your beat" section. Falls back gracefully when the table is empty
(no beat = no section).

## UI

New section on the Account page: a textarea with "Describe your beat in
1-3 sentences" placeholder, a save button, a small "Last refreshed N
hours ago" caption, and a preview list of the top 5 matches from the
last 7 days. Surfacing matches inline gives immediate feedback when the
user iterates on the description.

Optional pulled-in into the watchlist drawer as a "Your beat" header row
that links to the account section.

## Files

### New
- `server/beats/profile.js`
- `server/beats/match.js`
- `src/components/account/BeatSection.jsx`
- `test/beatProfile.test.js`
- `test/beatMatch.test.js`

### Modified
- `server/storage.js` — add the table to `ensureSchema`.
- `server/index.js` — wire the four routes.
- `server/alerts/dailyDigest.js` — include beat-match section.
- `src/services/backendService.js` — `fetchBeat`, `saveBeat`, `deleteBeat`, `fetchBeatMatches`.
- `src/pages/AccountPage.jsx` — mount BeatSection.
- `src/utils/featureAccess.js` — add `beatAlerts`.
- `src/i18n/locales/en.json` — `beat.*` keys.

## Out of scope (defer)

- Realtime push notifications on new matches.
- Multiple beats per user.
- Sharing beat descriptions.
- LLM-suggested edits to the beat description.
