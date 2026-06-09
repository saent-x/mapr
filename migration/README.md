<!-- migration/README.md — operator runbook for the one-shot legacy → Convex backfill. -->

# MAPR migration

One-shot, **idempotent, re-runnable** job that backfills the legacy MAPR data
into the locked Convex backend and stages Stripe billing for relink-on-login.

Two workstreams (both converge on re-run):

1. **Data backfill** — legacy SQLite `articles` are transformed to the frozen
   `ingest:ingestBatch` article shape, **re-embedded** through the Rust `/embed`
   service (1024-dim bge-m3, L2-normalized), batched (~50), and upserted by
   `externalId`. The backend derives `searchText`/`recencyBucket` and recomputes
   each correlated event itself.
2. **Stripe relink** — legacy users carrying `stripeCustomerId` +
   `subscriptionStatus` are staged via `ingest:stagePendingBilling` (keyed by
   email). **Convex Auth applies the staged billing to the user on first
   magic-link login** — and immediately if the user already exists.

The legacy SQLite DB is opened **READ-ONLY** and is never modified. All Convex
traffic uses the verified raw HTTP function API (`POST /api/query`,
`/api/mutation`) — no SDK or websocket. SQLite is read via Node's built-in
`node:sqlite` (zero runtime dependencies; no native build).

## Requirements

- **Node ≥ 22.5** (uses `node:sqlite` + native TypeScript type-stripping). Verified on v25.
- The **Rust `/embed` service must be running** for the `apply` path (not for
  `--dry-run`). Default bind `http://127.0.0.1:8088/embed`, health at `/healthz`.
- The Convex backend deployed and reachable (dev: `http://127.0.0.1:3210`).

No `npm install` is required to run (zero runtime deps). `devDependencies`
(`@types/node`, `typescript`) exist only for `tsc --noEmit`/editor typecheck.

## Obtaining the legacy data

- **Articles/events** — the legacy SQLite file at `data/mapr.db` (repo root).
  Copy it somewhere and point `LEGACY_SQLITE_PATH` at it (or run from repo root
  / `migration/` — the default auto-resolves `data/mapr.db` and `../data/mapr.db`).
- **Users (billing)** — export from the **InstantDB dashboard**
  (App → *Sandbox/Explorer* → **Export** / or the admin API) as JSON, then set
  `INSTANT_EXPORT_PATH`. The loader is tolerant of common export shapes
  (`{ "$users": [...] }`, `{ "users": [...] }`, nested `{ data: {...} }`, or a
  bare array); it picks records that have `email` plus `stripeCustomerId` and/or
  `subscriptionStatus`, and stages only those with **all three** present.
  A legacy SQLite `users` table, if present, is also read automatically.

## Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `CONVEX_URL` | `http://127.0.0.1:3210` | Convex deployment base URL |
| `MAPR_INGEST_KEY` | `mapr-dev-ingest-secret` | Worker auth passed to every ingest mutation |
| `EMBED_URL` | `http://127.0.0.1:8088/embed` | Rust `/embed` endpoint (apply only) |
| `EMBED_BEARER` | _(unset)_ | Optional `Authorization: Bearer` for `/embed` |
| `LEGACY_SQLITE_PATH` | `data/mapr.db` → `../data/mapr.db` | Legacy SQLite DB (read-only) |
| `INSTANT_EXPORT_PATH` | _(unset)_ | InstantDB users export JSON (skips billing if unset) |

## Runbook: dry-run → apply → verify → cutover

```bash
cd migration

# 1. DRY RUN — read-only. Prints row counts per source, category/tier
#    breakdowns, derived event-cluster count, 3 spot-check transformed
#    articles, and a staged-billing sample. Writes NOTHING.
node --experimental-strip-types src/migrate.ts --dry-run
#    (or: npm run dry-run)

# 2. APPLY — start the Rust /embed service first, then:
EMBED_URL=http://127.0.0.1:8088/embed \
INSTANT_EXPORT_PATH=/path/to/instant-export.json \
node --experimental-strip-types src/migrate.ts
#    (or: npm run migrate). Add `--limit N` to backfill a subset first.
#    Idempotent: re-run any time — articles upsert by externalId, billing
#    upserts by email; counts converge (inserts → updates on re-run).

# 3. VERIFY — counts via the public query (or the Convex dashboard):
curl -s -X POST "$CONVEX_URL/api/query" -H 'content-type: application/json' \
  -d '{"path":"events:list","args":{},"format":"json"}'
#    The apply run also prints inserted/updated/events/staged/errors and an
#    events:list count at the end.

# 4. CUTOVER — once counts look right and the embed service has produced real
#    bge-m3 vectors, point the web app at the Convex backend and decommission
#    the legacy InstantDB + SQLite stores. Staged billing auto-applies as users
#    log in; no further migration step is needed.
```

### Flags

- `--dry-run` — read-only inspection; no writes (no embed service needed).
- `--limit N` — cap the number of legacy articles processed (newest first).
  Useful for a staged apply or a smoke test before the full backfill.

### Notes

- **Embeddings are recomputed, never copied.** Legacy stores held no
  Convex-compatible vectors, so apply requires the embed service to be up. This
  is an operator step, not a stub.
- **Event correlation.** The legacy stores carry no event/cluster id (the
  `events`/`event_articles` tables are empty), so the job synthesizes a stable
  `eventKey = "{isoA2}:{category}:{UTC-day}"`. `ingestBatch` collapses each
  cluster into one event (representative = most severe, tier = highest).
- **Severity & category.** Legacy severity (0..100) is scaled to the contract's
  0..10 and mapped to a tier (`green`/`amber`/`red`/`black`) consistent with the
  deployed seed corpus. Legacy categories are mapped to the canonical set
  (`conflict|cyber|unrest|seismic|weather|economic|health|maritime|tech`),
  refined by the NER hint when the top-level label is generic; unmapped labels
  pass through lowercased.
- **Per-batch resilience.** A failing embed/ingest batch is logged and skipped;
  the run continues and the final summary reports `errors E` (process exit code
  is non-zero when any error occurred).
