# mapr — Architecture & Design Audit

_Adversarial multi-agent audit (8 dimensions; every finding verified against the real code). 44 confirmed flaws, 1 rejected._

**Severity:** 5 critical · 15 high · 17 medium · 7 low

Status: ✅ fixed · ◐ partial (hardened, remainder scoped) · ⬜ open

## Fixed + verified this session (all E2E/API-tested on the live stack — 8/8 Playwright green)

- ✅ **Real RAG investigation** — composer → rag.ask → cited card (was hardcoded mock).
- ✅ **Real billing** — users.me + qa.quotaStatus + Console gating; Go Pro → live Stripe checkout (real $39/mo price).
- ✅ **Real Trends card** — trends.series → deterministic per-tier sparklines.
- ✅ **Real Signals** — trends.anomalies + fired watches (badge/ticker/drawer); dropped backend-less silence mock.
- ✅ **Real Entities + Dossier** — entities.graph + entities.dossier (co-occurrence graph, linked events).
- ✅ **Security: users.getById leak** — → internalQuery.
- ✅ **Billing fairness: QA quota** — charged only on persisted answer.
- ✅ **Sovereignty: map geometry** — vendored locally (no CDN).

## Hardening wave 2 — fixed + verified on the live stack (this session)

_Implemented across disjoint file-sets (Rust ingestor · Convex backend · frontend · ops), then verified by: full `convex deploy` (whole-backend typecheck + schema validation), `cargo test` (76 passed), two live `--once` ingest cycles against real Convex + Ollama, and **13/13 Playwright E2E green** on the deployed stack._

- ✅ **#10/#18 Only-embed-changed** — added `articles.contentHash`; ingestor queries `contentHashesByExternalIds` (batched 256/query to stay under Convex's 16MB read budget) and skips unchanged drafts. **Live: 2398/2435 skipped, only 37 embedded** (was: re-embed all 2435 every cycle).
- ✅ **#9 Incremental embed** — per-chunk embed→ingest; one Ollama failure skips a chunk, not the cycle (`failed_chunks=0` live).
- ✅ **#10(fetch) Concurrent source fetch** — `buffer_unordered(8)` + jittered retry/backoff; per-source isolation (102 sources fetched concurrently live).
- ✅ **#11 Geocoder salience** — title>summary, dateline/agency down-weight, earliest-mention; length only as tiebreaker (+unit test).
- ✅ **#24 NER** — wire-service/agency stoplist + dateline-token drop. **#39 Dedup** — MinHash banding replaces O(n²) Jaccard.
- ✅ **#7 Coverage rollup** — `coverage` table written at ingest; `regionCoverage` reads O(regions) (132 regions live, shape preserved).
- ✅ **#23 Honest totals** — exact counts + `truncated` flag (`{exact:true,total:4143,truncated:true}`).
- ✅ **#8/#35 Watch sweep** — paginated cursor (no 500 cap) + `by_iso`-indexed scope reads + grouped identical scopes.
- ✅ **#19 Observability** — `ops.checkIngestHealth` staleness cron (Resend-gated) + `/health` liveness route.
- ✅ **#30 Stripe webhook** — `client_reference_id` fallback links + patches the user when `by_stripeCustomerId` misses; failed-resolve → non-2xx retry.
- ✅ **#42 SSRF at write** · **#41 flag-leak minimized** · **#43 rolling 30d QA window** · **#36 corroboration reads sourceCatalog metadata** · **#38 recency post-filter**.
- ✅ **#13 maplibre lazy+split** — main chunk 86KB (was ~1.42MB); maplibre isolated cacheable chunk. **#27 loading/empty states** wired.
- ✅ **#33 log rotation** · **#34 backup quiescing + honest PHASE0 doc** · **#44 cloudflared pinned + break-glass runbook**.
- ◐ **#16/#31 email verification** — ADMIN_EMAILS grant now gated on verification; a Resend OTP `verify` provider is wired behind an env flag (off by default to not break the current immediate-sign-in flow).
- ◐ **#32 Ollama contention** — documented trade-off + operator mitigations in compose (no behavior change). ◐ **#1 eventKey** within-day cross-cycle join (full persisted-event join still scoped). ◐ **#5/#37** most differentiators now real; TimeScrubber/Corroboration remain illustrative.

---


## CRITICAL

### 1. ◐ eventKey is anchored on the per-batch cluster, so ongoing events fragment into a new event every cycle

- **Effort:** L | **Loc:** `ingestor/src/correlate.rs:88-100 (anchor = min externalId of in-batch cluster)`
- **Fix:** Make the anchor independent of batch membership. Join an incoming article to an existing event by querying persisted events/articles in the same (isoA2, time-window) and matching on token-Jaccard >= threshold (the events `by_externalId` index and articles `by_iso`/search filterFields[isoA2,recencyBucket,category] in schema.ts already support this), rather than anchoring on the in-batch min externa

### 2. ✅ The core investigation flow is faked: runQuery returns a hard-coded MAPR.sampleAnswer, no RAG

- **Effort:** L | **Loc:** `web/src/sw/Console.jsx:114-129 (runQuery) + :126`
- **Fix:** Sound and correctly scoped. The wiring target already exists: call the orphaned useInvestigation().run() from runQuery, render real pending→result state, and render evidence through the existing buildInvestigation output. IMPORTANT correction the finder missed: InvestigationCard (cards.jsx:83) reads ans.evidenceIds.map(id => MAPR.byId[id]), but buildInvestigation returns ans.evidence as full objec

### 3. ✅ Shipped frontend has no real billing/quota/Pro wiring — plan is mock client state

- **Effort:** L | **Loc:** `web/src/sw/Console.jsx:45,144-154,395`
- **Fix:** Wire the sw UI to the backend that already exists: drive plan/limits from useQuery(users.me), drive quota from qa.quotaStatus, make Upgrade call useAction(billing.createCheckout) and redirect to the returned Stripe URL, make Manage call billing.createPortal, and make onMove('brief'/'export'/'correlate') call the real mutations (briefs.generate, exports.*) and surface the server FEATURE_LOCKED erro

### 4. ✅ The flagship "ask the analyst" answer is a hardcoded mock — the real RAG pipeline is never called by the shipped UI

- **Effort:** M | **Loc:** `web/src/sw/Console.jsx:114-129 (runQuery) + web/src/sw/data.js:134-159 (sampleAnswer)`
- **Fix:** Sound and correctly scoped, with one important correction to the finder's claim. The finder said rag.ask is 'NEVER imported or called anywhere in web/src/sw' — that is FALSE: rag.ask IS imported and fully wired in web/src/sw/api/hooks.js:46 via useInvestigation(), which also calls events.intentSearch + events.byIds and runs the result through buildInvestigation (adapters.js:108) — a complete, writ

### 5. ◐ Five of seven headline differentiators render from data.js mock, not the backend that computes them

- **Effort:** L | **Loc:** `web/src/sw/features.jsx (CorroborationLattice:61, EntityGraph:88, TimeScrubber:13, CaseCard:161, FeedsDrawer:124) + web/src/sw/cards.jsx (TrendsCard:1`
- **Fix:** Sound and correctly prioritized. EntityGraph→entities.graph + entities.edgeProof first is the right call: I verified edgeProof (entities.ts:178) is fully built and exactly matches the lattice interaction. CorroborationLattice→intel.overview/trends.evidence and TimeScrubber→derive window from live firstSeenAt are both supported by existing endpoints (intel.overview, trends.evidence confirmed presen


## HIGH

### 6. ⬜ Corpus is short blurbs, not passages — full article bodies are never ingested and retrieval feeds the LLM only a ~220-char excerpt

- **Effort:** L | **Loc:** `convex/functions/rag.ts:14,45-48,216-221`
- **Fix:** Add real body extraction to the Rust ingestor (follow the article URL, extract main text), chunk to ~512-800 token windows, embed each chunk with bge-m3, and store a chunks table keyed to article+event so retrieval returns passages. CHEAPEST FIRST WIN the finder missed: the DB already stores fuller summaries (RSS descriptions, HTML bodies up to 1000 chars) than the LLM ever sees — raising MAX_EXCE

### 7. ✅ Reactive full-window scans re-run for every client on every ingest write

- **Effort:** L | **Loc:** `convex/functions/events.ts:42-48 (list), 61-66 (regionCoverage)`
- **Fix:** Sound and correctly targeted at the wired path. Precompute rollups in the ingest mutation: maintain time-bucketed counters / write the existing coverage table from recomputeEvent so regionCoverage reads a handful of pre-aggregated rows instead of scanning 2000; serve the map feed via usePaginatedQuery (bounded page = bounded read set) or a smaller cap. The @convex-dev/aggregate suggestion is the i

### 8. ✅ Standing-watch sweep is O(watches × full scan) and hard-capped at 500 watches

- **Effort:** M | **Loc:** `convex/functions/watchBaselines.ts:353 (.take(SWEEP_BATCH=500), no cursor), 350-356 (listWatchIdsWithBaseline), 35-48 (loadScopeEvents), 431-464 (swee`
- **Fix:** Sound. (1) Replace .take(500) with a paginated cursor loop or a scheduled fan-out so all baselines are swept. (2) For region watches, drive loadScopeEvents off the existing by_iso index (schema.ts:109) instead of scan+filter. (3) Trigger the sweep from the ingest cycle on the set of changed event keys rather than a blind hourly full re-scan per watch. All three are concrete and correct.

### 9. ✅ One Ollama embedding failure discards the entire cycle's articles (no partial progress, no checkpoint)

- **Effort:** M | **Loc:** `ingestor/src/pipeline.rs:203-215 (embed_drafts uses ? per chunk), 275-277 (run_cycle propagates before ingest_batch at 281-288)`
- **Fix:** Embed and write incrementally: for each chunk that succeeds, finalize() + ingest_batch() those drafts immediately (ingestBatch in ingest.ts is idempotent and chunk-safe), and on a chunk error log+skip that chunk rather than aborting. Add a bounded retry (2-3 attempts, exponential backoff) around embedder.embed() for 5xx/timeout before giving up on a chunk. Turns a whole-cycle loss into at worst a 

### 10. ✅ Source fetches are fully sequential with no concurrency, retry, or backoff — one slow source throttles the whole pipeline

- **Effort:** M | **Loc:** `ingestor/src/pipeline.rs:237-270 (sequential `for source in &sources`)`
- **Fix:** Fetch sources concurrently with a bounded worker pool (futures::stream::iter(sources).map(fetch_source).buffer_unordered(8) or a tokio Semaphore), collecting RawItems as they complete. Add jittered retry-with-backoff (e.g. 2 retries) for timeouts/5xx/429 in guarded_get, honoring Retry-After for 429. Bounds cycle time to ~max(source latency).

### 11. ✅ Geocoder picks the longest gazetteer name in the text, not the event location — wire datelines mislocate stories

- **Effort:** M | **Loc:** `ingestor/src/geocode.rs:393-453 (resolve: 'longest match wins' for cities then countries, text position ignored)`
- **Fix:** Rank candidate matches by salience, not name length: prefer title over summary, prefer earliest title mention (or occurrence count), down-weight known dateline/agency tokens. At minimum switch the tiebreak from longest-name to first-in-title. NOTE: the finder's secondary suggestion to 'fall back to GDELT sourcecountry/location when title/summary disagree' is only partially viable — GDELT exposes o

### 12. ✅ Choropleth fetches country geometry from public jsDelivr CDN at runtime — breaks the self-hosted / sovereign promise

- **Effort:** M | **Loc:** `web/src/sw/MaprMap.jsx:33-43 (loadWorld → fetch https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json), :85 .catch(()=>{}) swallows failure`
- **Fix:** Sound and correctly scoped. Vendor countries-110m.json into the app/static host and import it; self-host (or config-gate) the basemap style + glyphs/sprites/tiles for a true sovereign install; and at minimum surface the swallowed fetch failure as a visible map-error state. All three sub-points match real code.

### 13. ✅ maplibre eagerly imported by the landing route → 1.42MB main chunk; warning limit raised to hide it

- **Effort:** M | **Loc:** `web/vite.config.js:10 (chunkSizeWarningLimit:1400)`
- **Fix:** Sound. React.lazy() MaprMap behind Suspense so cold-open/composer render immediately; add manualChunks to split maplibre into a cacheable vendor chunk; lower chunkSizeWarningLimit back toward ~500-600 so regressions are caught. Realistic.

### 14. ⬜ Choropleth rewrite demoted per-event plotting and orphaned bidirectional hover (hoveredId is dead)

- **Effort:** M | **Loc:** `web/src/sw/MaprMap.jsx:74 (signature: {theme,mode,events,focus,onEventClick,dimmed,timeThreshold} — no hoveredId)`
- **Fix:** Sound and notably well-supported: the vendored mapcn already exports a clustered GeoJSON point layer (mapcn.tsx:1536-1552: data, clusterMaxZoom, clusterRadius, clusterColors, onClick for unclustered points). So adding clickable individual events at higher zoom over the choropleth is cheaper than the finding implies — reuse the existing MarkerLayer rather than hand-rolling. Re-wire hover via featur

### 15. ✅ Public users.getById leaks any user's full record (email, phone, Stripe customer id, role)

- **Effort:** S | **Loc:** `convex/functions/users.ts:62-65 (getById)`
- **Fix:** Convert getById to `internalQuery` so it is only callable server-side from the billing actions (change `query`→`internalQuery` and update the two billing.ts call sites from `api.users.getById` to `internal.users.getById`). The client-facing 'my user' read is already covered by users.me (users.ts:7-24), which scopes to getAuthUserId and returns a curated projection that excludes stripeCustomerId/ph

### 16. ◐ Password sign-up has no email verification — enables admin takeover via ADMIN_EMAILS and account squatting

- **Effort:** M | **Loc:** `convex/functions/auth.ts:11-32 (Password<DataModel>() + afterUserCreatedOrUpdated)`
- **Fix:** Add email verification to the Password provider (`Password({ verify: <email provider> })`) so an address must be confirmed before the account is usable, AND gate the ADMIN_EMAILS auto-grant on `user.emailVerificationTime != null`. If email transport genuinely can't be added on the self-host, remove admin promotion from self-service sign-up entirely — seed the admin role via a one-time internalMuta

### 17. ✅ QA quota is charged even when retrieval/generation fails — users pay for errors

- **Effort:** M | **Loc:** `convex/functions/rag.ts:347-381`
- **Fix:** Only charge on a successful, persisted answer. Either (a) check the limit in beginTurn but move the increment into qa.completeTurn so a failed turn never counts, or (b) keep the reserve and add an internal refundTurn mutation called in a try/catch around generate in ask() to decrement qaWindowCount on any throw. Option (a) is cleaner.

### 18. ✅ Every ingest cycle re-embeds the entire ~2500-article corpus on CPU — wasted compute that contends with paid-user RAG

- **Effort:** M | **Loc:** `ingestor/src/pipeline.rs:203-296 (embed_drafts/run_cycle)`
- **Fix:** Add a contentHash (hash of embed_text = title+summary) column to articles; have ingestBatch (or a cheap companion query) return which externalIds are new or whose hash changed; in pipeline.rs only embed those drafts and copy the stored vector for the rest. This cuts embedding load ~95% (76 vs 2574/cycle) and removes most ingest↔QA CPU contention. The finder's fix is sound and correctly scoped.

### 19. ✅ Zero observability/alerting — failures are invisible until a human opens the admin page

- **Effort:** M | **Loc:** `convex/functions/admin.ts:126-160 (health query, requireAdmin)`
- **Fix:** (1) Ingestor heartbeat: write last-success timestamp to Convex each cycle; a small Convex cron emails via the existing Resend integration if no success in >Nx interval. (2) Add a healthcheck (liveness file touched each loop, or a /healthz exposing last-cycle age). (3) Free external uptime monitor on the public origin + a Convex query. All sound, near-free, and correctly scoped to a single box.

### 20. ⬜ "Silence detection" (absence-of-signal) is advertised as a key differentiator but has zero backend — pure vaporware

- **Effort:** L | **Loc:** `web/src/sw/data.js:161-165 (silenceSignals), :279 (feature flag)`
- **Fix:** Sound. The 'build it or stop selling it' framing is correct, and the cheap-build sketch (rolling per-region hourly count + trailing-30d mean/stddev + emit alertStream 'silence' row, reusing watchBaselines sweep/alertStream infra) is technically plausible against the existing schema. The fallback (remove the silenceSignals mock + account toggle) is the right minimum.


## MEDIUM

### 21. ⬜ Generation defaults to qwen2.5:3b on a CPU box with no streaming and a corrective retry that doubles worst-case latency

- **Effort:** M | **Loc:** `convex/functions/rag.ts:17,254,255,258-296,330-389`
- **Fix:** Move generation to a free hosted OpenAI-compatible model (Groq Llama-3.3-70B free tier or Gemini 2.5 Flash-Lite free tier). This is genuinely low-effort because the existing call already POSTs to a `${base}/v1/chat/completions` OpenAI-compatible endpoint with optional Bearer auth (rag.ts:262-268) — swapping OLLAMA_URL/LLM_MODEL/OLLAMA_BEARER points it at the hosted provider with no code change bey

### 22. ⬜ Digest crons collect entire alertRules and watchlistItems tables every hour

- **Effort:** S | **Loc:** `convex/functions/digests.ts:29 (dueDailyDigests .collect()), 51 (dueWatchlistDigests .collect())`
- **Fix:** Sound. Store an explicit digestHourUTC scalar (+ active flag) on alertRules/watchlistItems with .index('by_digest_hour', ['digestHourUTC']) and query only rows due this hour, or maintain a small dispatch table keyed by hour. Replace .collect() with the indexed query so hourly cost is O(rules due this hour).

### 23. ✅ User-facing aggregates silently truncate at fixed caps, producing wrong totals during spikes

- **Effort:** M | **Loc:** `convex/functions/events.ts:12-13 (FEED_LIMIT 600, RECENT_SCAN_LIMIT 2000), 65,77 (regionCoverage)`
- **Fix:** Sound and consistent with finding #1: serve counts from incrementally-maintained aggregates so totals are exact regardless of volume; where a list must stay capped, surface an explicit truncated/approxTotal flag and paginate via usePaginatedQuery. At minimum compute total/choropleth/tier counts from a count aggregate rather than events.length of a truncated take.

### 24. ✅ NER leaks wire-service names and dateline tokens as entities

- **Effort:** S | **Loc:** `ingestor/src/ner.rs:11-105 (STOP list has no agencies/datelines), 112-120 (is_capitalized accepts 2-char all-caps like 'AP'/'UN'), 127-172 (no positio`
- **Fix:** Add a wire-service/agency stoplist (reuters, ap, afp, dpa, efe, ansa, pti, xinhua, tass, cnn, bbc, etc.), drop a leading ALL-CAPS dateline token immediately followed by ',' or '(', reject pure 2-char acronyms unless whitelisted, and skip/normalize extraction when the headline is mostly uppercase. Cheap deterministic filters; add fixtures from real wire datelines.

### 25. ⬜ Velocity 'surge' bump is computed per-cycle, not over a real time window — it conflates batch size with momentum

- **Effort:** M | **Loc:** `ingestor/src/velocity.rs:27-53 (counts from Velocity::from_pairs over one batch`
- **Fix:** Compute velocity from a persisted rolling window: query Convex for article counts per (category, isoA2) over the last ~6-24h using the articles search filterFields [isoA2, recencyBucket, category] (schema.ts) and feed that into bump() instead of (or in addition to) the in-batch count. Keep the cap. Makes the surge signal reflect real momentum and reproducible regardless of cron cadence.

### 26. ⬜ Console is a 408-line god component with ~18 ungrouped useState slices and no context/reducer

- **Effort:** M | **Loc:** `web/src/sw/Console.jsx:42-58 (18 flat useState: drawer/modal/cold/plan/chips/thread/threadOpen/pending/picked/hoveredId/focus/text/toasts/rewind/scrub`
- **Fix:** Reasonable and correctly scoped to medium. useReducer for the investigation/thread/chips/focus domain exposed via ConsoleContext to cut the ~8 drilled callbacks; keep ephemeral chrome local; hoist static arrays out of render. This is real tech-debt rather than a user-facing bug — medium is the right severity. Worth noting this is the same seam needed to wire real data (finding #1), so it pairs nat

### 27. ✅ Missing loading/error/empty states — useEvents exposes loading but Console ignores it

- **Effort:** S | **Loc:** `web/src/sw/api/hooks.js:24 (returns {events, loading: rows===undefined})`
- **Fix:** Sound and appropriately scoped to S. Consume loading for skeletons on the topbar pill/legend; add an error boundary + retry around the Convex query and the geometry fetch; distinguish 'no events in window' from 'still loading'. Matches the actual gaps.

### 28. ⬜ Map and markers are inaccessible: no keyboard, ARIA, or alt text across interactive surfaces

- **Effort:** M | **Loc:** `web/src/sw/MaprMap.jsx (canvas mousemove/click only, no keyboard path)`
- **Fix:** Sound. Expose the choropleth's severityByCountry as a focusable keyboard-navigable region list driving the same setFocus; add aria-live='polite' for scope/count; add role+tabIndex+onKeyDown to ticker/legend/evidence interactive elements; add a non-color severity indicator (the existing TIERS labels); run axe-core in CI. Correctly scoped to medium given the stated government/analyst buyer.

### 29. ⬜ No brute-force / rate limiting on password sign-in or on the metered rag.ask LLM action

- **Effort:** M | **Loc:** `convex/functions/auth.ts:11-12 (Password provider)`
- **Fix:** Add the Convex @convex-dev/rate-limiter component: a token-bucket on sign-in attempts keyed by email (and any available client identifier), plus a short-window limiter (e.g. ~1 ask per 10s with a small burst) on rag.ask in addition to the monthly quota. This also shields the LLM box from client retry storms.

### 30. ✅ Stripe webhook strands customers when by_stripeCustomerId lookup misses (no fallback, no retry, no alert)

- **Effort:** M | **Loc:** `convex/functions/http.ts:54-71,73-83`
- **Fix:** In the checkout.session.completed branch, fall back to session.client_reference_id (the Convex userId) to find/patch the user and link stripeCustomerId when by_stripeCustomerId misses. Have apply signal 'no user found' so the http action can return 5xx (within Stripe's retry window) instead of acking 200, OR record the unmatched event for later reconciliation. Add a log/metric on applied:false so 

### 31. ◐ Unverified Password auth + ADMIN_EMAILS self-service grant yields unlimited Pro to anyone registering an unclaimed admin email

- **Effort:** M | **Loc:** `convex/functions/auth.ts:12,14-30 (esp. 23-24)`
- **Fix:** Enable email verification on the Password provider (Password({ verify: <email provider> })) so admin/billing identity is tied to a proven address, and gate the ADMIN_EMAILS grant on user.emailVerificationTime being set. Prefer promoting admins via an internal mutation rather than self-service email match; at minimum document that ADMIN_EMAILS is only safe with verification enabled.

### 32. ◐ Single CPU-only Ollama serves both ingest embeddings and live RAG — resource contention + latency spikes under load

- **Effort:** M | **Loc:** `deploy/docker-compose.yml:86-105 (ollama, OLLAMA_KEEP_ALIVE=15m, mem_limit 8g, no OLLAMA_NUM_PARALLEL/MAX_LOADED_MODELS)`
- **Fix:** Keep step (2) [gate/off-peak the ingest embedding burst so it never overlaps a user generation — combine with finding #1 to shrink the burst] and step (3) [consider a cheap hosted API for qwen-class chat, keeping only bge-m3 local] — both sound. DOWNGRADE/CORRECT step (1): the premise of a 'per-request model unload/reload swap on every turn' is wrong. Ollama's OLLAMA_MAX_LOADED_MODELS defaults to 

### 33. ✅ No log rotation configured — default json-file driver can fill the 256GB disk and take the box down

- **Effort:** S | **Loc:** `deploy/docker-compose.yml (no `logging:` block on any service)`
- **Fix:** Add a shared `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }` default to each long-running service (or set it once in /etc/docker/daemon.json). ~30 min. Pair with a disk-usage alert (finding #4). Recommendation is sound and correctly scoped.

### 34. ✅ Documented mitigations don't exist; backup hot-tars SQLite without quiescing — restore artifact may be corrupt

- **Effort:** S | **Loc:** `deploy/PHASE0-VERIFICATION.md:49 (claims MAX_CONCURRENT_LLM=1 + off-peak ingest 'documented in deploy/README')`
- **Fix:** (1) Either implement the concurrency gate (finding #2) or correct the PHASE0 doc so operators aren't misled. (2) Make the snapshot consistent: `docker compose stop convex-backend` before the tar and restart after (the comment already promises this), OR drop the raw tar and rely on the transactionally-consistent `convex export` already taken at backup.sh:32. (3) Run the restore.md drill once into a

### 35. ✅ watchBaselines (the one real paid differentiator) silently breaks at scale: 1000-event window cap + unbounded multi-tenant sweep

- **Effort:** M | **Loc:** `convex/functions/watchBaselines.ts:42-47 (loadScopeEvents take(1000)), :350-356 (listWatchIdsWithBaseline take(SWEEP_BATCH=500)), :431-463 (sweepWatch`
- **Fix:** Mechanically sound; I am lowering severity from high to medium. The recommendation (scope-keyed index to filter in-DB, paginate the sweep with a cursor, group identical scopes) is correct and well-targeted. Severity reduction rationale: this is a correctness-at-scale degradation, not a current shipped-product failure — and critically, watchBaselines itself is NOT wired into the rendered UI either 

### 36. ✅ Source verification/corroboration is name-substring guessing, not real source intelligence — undercuts the central 'provenance is first-class' claim

- **Effort:** M | **Loc:** `convex/functions/lib/sourceConfidence.ts:18-30 (classifySourceName), :38-42 (evidenceFromArticles), :86-87 (confidence thresholds)`
- **Fix:** Sound. Promoting sourceCatalog (schema already carries sourceType/verificationLevel) to source of truth and reading stored values in summarizeSources is the correct fix, and deriving corroboration from distinct ownership clusters rather than distinct names is a genuine integrity improvement ('5 co-owned outlets ≠ 5 independent confirmations'). The schema fields it depends on exist (verified in sou

### 37. ◐ Free tier proves nothing it claims to: 'live data, detects change, cites sources' are all mock in the shipped flow

- **Effort:** M | **Loc:** `PRODUCT.md (Positioning + 'Free proves trust' principle)`
- **Fix:** Sound and well-scoped. The 'smallest believable real loop' framing (live map [done] → real rag.ask answer → real trends.series → real entities.dossier, gate persistence/export behind Pro) is the right product call and all four backends are confirmed to exist (events.list, rag.ask, trends.series, entities.dossier).


## LOW

### 38. ✅ recencyBucket equality filter is frozen at ingest and never re-bucketed as articles age

- **Effort:** S | **Loc:** `convex/functions/lib/recency.ts:27-46`
- **Fix:** Sound. Given pruneOld deletes everything >14d (ingest.ts:263), option (a) — drop recencyBucket as a vector/search filter and rely on the publishedAt post-filter — is the cheapest correct fix; option (b) a daily re-bucketing internalMutation mirroring pruneOld's self-reschedule also works.

### 39. ✅ Dedup phase-2 is O(n^2) full-Jaccard with no blocking — degrades as source volume grows

- **Effort:** M | **Loc:** `ingestor/src/dedup.rs:228-240 (each item compared against every prior kept item via token_cache.iter().any) and 179-192 (jaccard rebuilds two HashSets`
- **Fix:** Block before comparing: bucket candidates by a cheap key (geocoded isoA2, or a few high-signal tokens / MinHash band) and only run Jaccard within a bucket. Precompute each item's token HashSet once instead of rebuilding both sides per comparison (the cheap, S-effort half). MinHash/LSH banding is the larger M-effort half. Drops practical cost toward linear without changing dedup semantics. Low prio

### 40. ⬜ No password-reset path — locked-out users are unrecoverable, pushing toward insecure workarounds

- **Effort:** M | **Loc:** `convex/functions/auth.ts:11-12 (no reset provider)`
- **Fix:** Configure the Password provider's `reset` option with an email OTP/link provider (sharing the same email transport as `verify`) and wire a real 'Forgot password' flow into AuthPage.jsx. If email is truly out of scope for the self-host, ship an operator runbook + a dedicated internalMutation for resets rather than ad-hoc DB edits.

### 41. ✅ featureFlags query is unauthenticated and returns the full flag table to anyone

- **Effort:** S | **Loc:** `convex/functions/admin.ts:81-87 (featureFlags)`
- **Fix:** Return only the minimal flags the unauthenticated UI needs (a hardcoded allowlist of public keys, values only — drop `description`), or require auth and return the public subset. Keep setFeatureFlag as-is (admin.ts:89-104 already calls requireAdmin).

### 42. ✅ Admin-writable source URLs are fetched by the ingestor with SSRF protection enforced only in the worker, not at the catalog write

- **Effort:** M | **Loc:** `convex/functions/admin.ts:14-60 (addSource) and convex/functions/sourceRequests.ts:70-110 (review/approveAsSource)`
- **Fix:** Validate the URL at write time in addSource and sourceRequests.review (mirror is_public_http_url: require http(s) scheme, reject private/reserved IP literals and internal hostnames) so the catalog can never hold a private-target URL. Longer term, close the documented TOCTOU gap with a custom reqwest connector that pins the validated IP for connect. IMPORTANT scoping (verified): GDELT entries store

### 43. ✅ Trailing-30d QA window is a fixed reset, not rolling — ~2x over-grant at the seam; disagrees with sourceRequests

- **Effort:** M | **Loc:** `convex/functions/qa.ts:31-40,162-164`
- **Fix:** Make QA metering rolling like sourceRequests: count qaMessages with role='user' and createdAt >= now-30d at check time (or use a sliding-window/token-bucket) instead of a reset counter. If keeping fixed windows, label the UI 'resets on <date>' rather than 'trailing 30 days' for honesty.

### 44. ✅ Cloudflare Tunnel is a single un-redundant ingress with no documented break-glass path

- **Effort:** S | **Loc:** `deploy/docker-compose.yml:213-226 (single cloudflared, image :latest, --no-autoupdate, no healthcheck)`
- **Fix:** (1) Document a break-glass one-liner (temporary `cloudflared tunnel --url` quick tunnel or SSH reverse tunnel) for when the named tunnel is down. (2) Pin cloudflared to a known-good version tag instead of :latest (the :latest + --no-autoupdate combo is the worst case: no auto-update AND non-reproducible), OR drop --no-autoupdate. (3) Add a healthcheck + the external monitor from finding #4. Full i

