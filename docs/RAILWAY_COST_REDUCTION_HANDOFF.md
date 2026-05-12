# Railway Cost Reduction Handoff

Date: 2026-04-27
Project: mapr
Goal: keep Railway usage inside the $5/month Hobby plan as much as possible for an open-source, non-commercial deployment.

## Context

The project is hosted on Railway with:

- One main app service.
- One PostgreSQL service.
- Railway Hobby plan budget target: approximately $5/month.

The user reported that the deployment is regularly exceeding the Hobby plan allowance and costing around $11/month. The database appears to be the main resource consumer.

## Primary diagnosis

The issue is likely not excessive PostgreSQL connections. The storage pool is already small:

- `server/storage.js:19-24` uses `pg.Pool` with `max: 2`, `idleTimeoutMillis: 10000`, and `connectionTimeoutMillis: 5000`.

The more likely cost drivers are:

1. Scheduled ingestion frequency.
2. Large GDELT/RSS article batches.
3. Repeated article/event/snapshot/history writes.
4. PostgreSQL storage growth from article payloads.
5. Database trim defaults that previously assumed a much larger capacity.
6. App wakeups reducing the usefulness of Railway sleep.

## Product direction, new features, and scaling context

This work should not be interpreted as abandoning future growth. The current priority is to keep the live open-source deployment inexpensive, while preserving a path to scale if the project later needs heavier usage or richer features.

### Current product stance

- The hosted Railway deployment is a low-cost public/demo deployment, not a business-critical production system.
- The project should favor predictable monthly cost over maximum freshness.
- New features should be designed so they do not silently add background jobs, high-frequency polling, unbounded database writes, or always-on compute.
- Expensive capabilities should be optional, gated, cached, rate-limited, or disabled by default on the Railway Hobby profile.

### Existing feature areas visible in the codebase

The project already has several feature surfaces that affect scaling decisions:

1. News/event ingestion and map briefing
   - Main refresh pipeline: `server/ingest.js:478-634`
   - Briefing response builder: `server/ingest.js:169-216`
   - Public API routes: `server/index.js:275-315`

2. Region-specific briefing and backfill
   - Route: `server/index.js:403-407`
   - Backfill logic: `server/ingest.js:388-459`
   - This can become expensive because cache misses can trigger live GDELT and RSS work.

3. Admin/health operations
   - Admin health route: `server/index.js:418-428`
   - DB size route: `server/index.js:317-332`
   - DB trim route: `server/index.js:335-342`

4. Real-time/SSE updates
   - SSE route: `server/index.js:345-357`
   - Broadcast after refresh: `server/ingest.js:582-589`
   - Vessel broadcast path: `server/index.js:547-555`

5. Flight and vessel tracking
   - Flight tracker: `server/flightTracker.js:1-178`
   - Ship tracker: `server/shipTracker.js:1-164`
   - Startup gate: `server/index.js:540-546`
   - These should stay disabled by default for low-cost hosting.

### Feature implementation rules for the next agent

When adding new features, the next agent should apply these rules:

1. Default to no new always-on background workers.
2. Prefer user-triggered or scheduled-low-frequency work.
3. Put expensive features behind env flags.
4. Make Railway Hobby behavior the conservative baseline.
5. Add bounded storage for every new table or JSON history field.
6. Add explicit cache TTLs for every external API fetch.
7. Add rate limits or auth to endpoints that can force ingestion/backfill.
8. Avoid storing full raw API responses unless there is a clear user-facing need.
9. Prefer derived summaries over large historical payloads.
10. Add metrics/logs that expose cost-driving counts: fetched records, inserted rows, deleted rows, response size, and duration.

### Scaling roadmap

If the project later needs to scale beyond the Railway Hobby profile, use staged scaling rather than immediately increasing paid resources.

#### Stage 0: Current low-cost public deployment

Target:

- Stay close to Railway Hobby budget.
- Refresh every 6-12 hours.
- Keep DB under roughly 512 MB effective capacity.
- Keep tracking disabled.
- Keep manual expensive operations protected.

Recommended profile:

```bash
MAPR_DEPLOYMENT_PROFILE=railway-hobby
MAPR_LOW_RESOURCE_MODE=1
MAPR_REFRESH_MS=21600000
MAPR_STALE_AFTER_MS=43200000
MAPR_GDELT_MAX_RECORDS=100
MAPR_REGION_BACKFILL_MAX_RECORDS=15
MAPR_REGION_BACKFILL_FEED_LIMIT=3
MAPR_DB_CAPACITY_MB=512
MAPR_DB_TRIM_PERCENT=70
MAPR_DB_HARD_PERCENT=85
MAPR_DB_TRIM_BATCH=500
ENABLE_TRACKING=false
```

#### Stage 1: Better open-source demo without major spend

Use this only if current costs are stable:

- Keep one app service and one DB.
- Add endpoint protection/rate limiting before adding more public features.
- Cache region briefing misses.
- Add row-count and response-size observability.
- Reduce article payload size before increasing ingestion volume.

Possible feature work at this stage:

- Improved admin cost dashboard.
- Region briefing cache visibility.
- Manual admin-only refresh controls.
- Source health and source pruning UI.
- Better DB table-size/row-count inspection.

#### Stage 2: Moderate scale

Use this if the project starts getting real traffic or needs fresher data:

- Split ingestion from API serving.
- Run ingestion as a scheduled job/worker, not inside the public web process.
- Keep the public API mostly read-only and cache-friendly.
- Add CDN/edge caching for public briefing and event endpoints.
- Store current snapshot separately from historical data.
- Consider a managed Postgres tier with clearer storage/CPU headroom.

Possible architecture:

- Web/API service: serves cached data and static frontend.
- Worker service: performs ingestion on schedule.
- Postgres: stores compact normalized state.
- Optional object storage: stores large historical/archive payloads.

#### Stage 3: Full production-style scale

Only consider this if there is a real need:

- Queue-based ingestion.
- Separate read and write paths.
- External cache such as Redis or CDN KV.
- Partitioned historical tables.
- Object storage for raw articles or archives.
- Observability dashboards and budget alerts.
- Per-source scheduling based on reliability and value.

## Relevant existing behavior

### Railway config

`railway.json:7-12` has:

- Start command: `node server/index.js`
- Restart policy: `ON_FAILURE`
- `sleepApplication: true`

This is good and should remain enabled unless there is a strong reason to disable it.

### Ingestion pipeline

The ingestion constants are in `server/ingest.js:79-88`.

Current behavior after the change:

- Railway is detected via `RAILWAY_ENVIRONMENT`.
- Railway defaults to deployment profile `railway-hobby`.
- Low-resource mode is enabled if either:
  - `MAPR_LOW_RESOURCE_MODE=1`, or
  - deployment profile is `railway-hobby`.

Current low-resource defaults:

- `MAPR_GDELT_TIMESPAN`: `24h`
- `MAPR_GDELT_MAX_RECORDS`: `100`
- `MAPR_REGION_BACKFILL_TIMESPAN`: `24h`
- `MAPR_REGION_BACKFILL_MAX_RECORDS`: `15`
- `MAPR_REGION_BACKFILL_FEED_LIMIT`: `3`
- `MAPR_REFRESH_MS`: `21600000` / 6 hours
- `MAPR_STALE_AFTER_MS`: `43200000` / 12 hours

Normal non-Railway defaults remain larger:

- GDELT max records: `750`
- Region backfill timespan: `168h`
- Region backfill max records: `80`
- Region feed limit: `12`
- Refresh interval: `30 minutes`
- Stale threshold: `30 minutes`

### Database writes during refresh

The main refresh pipeline is in `server/ingest.js:478-634`.

Important write stages:

- Article persistence: `server/ingest.js:522-523`
- Velocity tracking: `server/ingest.js:525-527`
- Event persistence and pruning: `server/ingest.js:535-537`
- Snapshot, coverage history, and refresh history writes: `server/ingest.js:570-580`

These are the main recurring database operations.

### Database size limits

The DB size limiter is in `server/storage.js:511-673`.

Current behavior after the change:

- Railway default capacity assumption: `512 MB`
- Railway soft trim threshold: `70%`
- Railway hard trim threshold: `85%`
- Railway target is `trim percent - 5%`

This means Railway default effective thresholds are roughly:

- Soft trim: 358 MB
- Hard trim: 435 MB
- Target after trim: 333 MB

Relevant code:

- `server/storage.js:535-545` resolves capacity/trim/hard/target limits.
- `server/storage.js:581-673` enforces those limits.
- `server/storage.js:583-588` reduces default trim batch size to `500` rows when capacity is `512 MB` or less.

### Tracking

Tracking is disabled unless explicitly enabled:

- `server/index.js:540-546` starts trackers only if `ENABLE_TRACKING=true`.

Recommendation: keep `ENABLE_TRACKING=false` or unset on Railway unless the feature is essential.

## Code changes already implemented

### `server/ingest.js`

Changed constants around `server/ingest.js:79-88` to:

- Add `MAPR_DEPLOYMENT_PROFILE`.
- Auto-detect Railway using `RAILWAY_ENVIRONMENT`.
- Treat Railway as `railway-hobby` by default.
- Make Railway/low-resource defaults much smaller.

Exact current logic:

```js
const DEPLOYMENT_PROFILE = (process.env.MAPR_DEPLOYMENT_PROFILE || (process.env.RAILWAY_ENVIRONMENT ? 'railway-hobby' : 'standard')).toLowerCase();
const LOW_RESOURCE_MODE = process.env.MAPR_LOW_RESOURCE_MODE === '1' || DEPLOYMENT_PROFILE === 'railway-hobby';
```

### `server/storage.js`

Changed DB size defaults around `server/storage.js:535-545` to:

- Use Railway-aware capacity and trim percentages.
- Keep larger defaults outside Railway.
- Preserve explicit environment variable overrides.

Changed trim batch default around `server/storage.js:583-588` to:

- Use `500` rows per pass for small Railway-like capacity.
- Use `1000` rows per pass elsewhere.

## Validation already performed

The following checks passed:

```bash
node --check server/ingest.js
node --check server/storage.js
```

The full test suite was run:

```bash
npm test
```

Result:

- 595 tests passed.
- 4 tests failed.
- Failures were all PostgreSQL integration tests in `test/storage.test.js`.
- Failure cause: local PostgreSQL was not running at `localhost:5432`, resulting in `ECONNREFUSED`.
- No syntax errors were found in the changed files.

## Recommended Railway environment variables

The code now has safe Railway defaults, but these env vars can make the intent explicit:

```bash
MAPR_DEPLOYMENT_PROFILE=railway-hobby
MAPR_LOW_RESOURCE_MODE=1
MAPR_REFRESH_MS=21600000
MAPR_STALE_AFTER_MS=43200000
MAPR_GDELT_MAX_RECORDS=100
MAPR_REGION_BACKFILL_MAX_RECORDS=15
MAPR_REGION_BACKFILL_FEED_LIMIT=3
MAPR_DB_CAPACITY_MB=512
MAPR_DB_TRIM_PERCENT=70
MAPR_DB_HARD_PERCENT=85
MAPR_DB_TRIM_BATCH=500
ENABLE_TRACKING=false
```

If Railway does not allow `ENABLE_TRACKING=false` to matter because the code checks for the string `true`, leaving it unset is also fine.

## Recommended Railway operational steps

1. Deploy the latest code.
2. Confirm Railway env has no aggressive overrides such as:
   - `MAPR_REFRESH_MS` below 6 hours.
   - `MAPR_GDELT_MAX_RECORDS` above 100.
   - `MAPR_DB_CAPACITY_MB` above 512 unless intentionally accepted.
   - `ENABLE_TRACKING=true`.
3. Visit or call the admin DB size endpoint:
   - `GET /api/admin/db-size`
   - Implemented in `server/index.js:317-332`.
4. Trigger a one-time DB trim after deployment:
   - `POST /api/admin/db-trim`
   - Implemented in `server/index.js:335-342`.
5. Watch Railway metrics for 24-72 hours:
   - DB CPU
   - DB memory
   - DB storage
   - app CPU
   - app memory
   - network egress
6. If cost is still too high, increase refresh interval further:
   - `MAPR_REFRESH_MS=43200000` for 12 hours.
   - `MAPR_STALE_AFTER_MS=86400000` for 24 hours.

## Suggested follow-up investigation for next agent

Ask the next agent to inspect these areas:

1. Article payload size
   - Table: `articles`
   - Column: `payload`
   - Code: `server/storage.js:270-341`
   - Check whether storing full normalized articles is necessary.

2. Snapshot size
   - Table: `metadata`
   - Key: `snapshot`
   - Code: `server/storage.js:178-183`
   - The snapshot stores the full current state as JSON.

3. Event support article reads
   - Code: `server/ingest.js:169-216`
   - Code: `server/storage.js:472-494`
   - Currently uses batch query, which is good, but verify response size and frequency.

4. Coverage and refresh history
   - Code: `server/storage.js:200-266`
   - Ensure history tables remain bounded and compact.

5. Source catalog size and source fetch behavior
   - Main pipeline: `server/pipeline/fetchSources.js`
   - Refresh orchestrator: `server/ingest.js:493-501`
   - Consider reducing RSS sources checked per refresh if DB/network usage remains high.

6. Manual refresh endpoint
   - Code: `server/index.js:410-414`
   - It currently allows `POST /api/refresh` without admin auth.
   - This could be abused to force expensive ingestion. Consider protecting it or rate-limiting it.

7. Region briefing endpoint
   - Code: `server/index.js:403-407`
   - Code: `server/ingest.js:388-459`
   - If a region has no existing articles, it performs live GDELT and RSS backfill.
   - Consider caching or rate-limiting this endpoint.

## High-impact future optimizations

If current changes are not enough, prioritize these:

1. Protect or rate-limit `POST /api/refresh`.
2. Cache `GET /api/region-briefing` misses to avoid repeated live backfills.
3. Reduce stored article payload size.
4. Store only article IDs and summary fields in snapshots.
5. Add a hard cap on number of articles kept per refresh snapshot.
6. Add per-refresh write counters to logs.
7. Add admin-only endpoint to show row counts by table.
8. Consider moving stale historical data to compressed object/blob storage or dropping it entirely for the open-source hosted demo.

## Risk notes

- Lower refresh frequency means the public map can show older data.
- Smaller GDELT batches may reduce geographic/event coverage.
- Aggressive DB trimming may remove older supporting articles sooner.
- Avoid manual `VACUUM` during normal trim cycles unless there is a specific storage emergency; repeated manual vacuuming can increase DB CPU.

## Current status

Implementation completed and syntax-validated. Full tests require local PostgreSQL to be running before they can pass.
