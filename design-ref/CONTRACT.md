# MAPR — locked Convex contract (verified on self-hosted Convex)

The Convex backend in `/convex/functions` is DEPLOYED and VERIFIED. Treat these
signatures as frozen. Function reference strings use `module:export` form.

## Worker auth
All ingestor/migration writes pass `ingestKey: string` validated against the
backend env `MAPR_INGEST_KEY` (dev value: `mapr-dev-ingest-secret`).

## ingest:ingestBatch  (mutation) — idempotent upsert + event correlation
```jsonc
args: {
  ingestKey: string,
  articles: Array<{
    externalId: string,   // dedup key (idempotent upsert)
    eventKey: string,     // correlation key -> groups articles into one event
    title: string,
    summary: string,
    source: string,
    url?: string,
    isoA2: string,        // ISO-3166 alpha-2 ("" if unlocated)
    lon: number, lat: number,
    tier: "green"|"amber"|"red"|"black",
    severity: number,     // 0..10
    category: string,     // conflict|cyber|unrest|seismic|weather|economic|health|maritime|tech
    publishedAt: number,  // ms epoch
    embedding: number[]   // bge-m3, EXACTLY 1024 floats, L2-normalized
  }>
}
returns: { inserted: number, updated: number, events: number }
```
Re-running the same batch converges (idempotent). The mutation derives
`recencyBucket` + `searchText` itself and recomputes each affected event
(representative = most severe; event severity = max; tier = highest tier).

## ingest:listSources (query)  args: { ingestKey } -> [{id,name,url,kind,region,category}]
## ingest:reportSourceHealth (mutation) args: { ingestKey, url, status:"ok"|"warn"|"err", error?, itemCount }
## ingest:consumeRefreshSignal (mutation) args: { ingestKey } -> boolean  (true => do an on-demand refresh)

## /embed HTTP contract (the Rust ingestor SERVES this; Convex rag.retrieve CALLS it)
```
POST {EMBED_URL}        body: { "inputs": string[], "normalize": true }
                        resp: { "vectors": number[][], "model": string, "took_ms": number }
```
Each vector MUST be 1024-dim, L2-normalized (bge-m3). Optional bearer:
`Authorization: Bearer {EMBED_BEARER}`.

## Convex client connection (self-host)
- URL: `CONVEX_SELF_HOSTED_URL` (dev: http://127.0.0.1:3210)
- The Rust `convex` crate connects via the deployment URL. Public functions
  (queries/mutations) are callable without a user token; the `ingestKey` arg is
  the worker authorization.

## Severity tiering convention (Rust assigns per-article; Convex aggregates)
green=routine, amber=elevated, red=critical, black=catastrophic. Map a 0..10
severity score to a tier; the event takes the highest-tier contributing article.

## Repo layout
/convex (DONE, deployed) · /ingestor (Rust) · /web (React+Vite) · /migration · /deploy · /design-ref

## Raw HTTP function API (leanest client; verified working on self-host)
Public functions are callable over plain HTTP — preferred for the Rust ingestor
and the migration job (no SDK/websocket needed):
```
POST {CONVEX_URL}/api/query     body: {"path":"events:list","args":{},"format":"json"}
POST {CONVEX_URL}/api/mutation  body: {"path":"ingest:ingestBatch","args":{...},"format":"json"}
resp: 200 {"status":"success","value": <result>}  |  {"status":"error","errorMessage": "..."}
```
`format:"json"` makes args/values plain JSON (numbers as JSON numbers; embeddings
as JSON arrays of numbers). The dev backend is at http://127.0.0.1:3210; admin key
lives in /convex/.env.local (only needed for deploy/codegen, NOT for calling
public functions).

## Migration staging contract
`ingest:stagePendingBilling` (mutation) args: { ingestKey, email, stripeCustomerId, subscriptionStatus }
— stages billing keyed by email; Convex Auth applies it to the user on first
magic-link login (and applies immediately if the user already exists).
