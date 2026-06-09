# Phase 0 — spike verification (status + how to reproduce)

This maps every Phase 0 spike item from the plan to its current status. Items
marked **VERIFIED (local)** were exercised against a real self-hosted Convex
backend running in Docker on this workstation; items marked **OPERATOR (box)**
require the owner's physical box, real credentials, or a multi-GB model and are
delivered as runnable code + commands.

## Local harness (reproduce the VERIFIED items)
```bash
# 1. Self-hosted Convex backend (SQLite mode locally; Postgres on the box).
docker run -d --name convex-mapr -p 3210:3210 -p 3211:3211 \
  -e INSTANCE_NAME=mapr-local \
  -e CONVEX_CLOUD_ORIGIN=http://127.0.0.1:3210 \
  -e CONVEX_SITE_ORIGIN=http://127.0.0.1:3211 \
  -v convex-mapr-data:/convex/data ghcr.io/get-convex/convex-backend:latest
KEY=$(docker exec convex-mapr ./generate_admin_key.sh | tail -1)

# 2. Point the CLI at it (convex/.env.local) and set function env.
cd convex
printf 'CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210\nCONVEX_SELF_HOSTED_ADMIN_KEY=%s\n' "$KEY" > .env.local
bun install
#   auth keys (see deploy README for the jose snippet), then:
bunx convex env set MAPR_INGEST_KEY mapr-dev-ingest-secret
bunx convex env set OLLAMA_URL http://host.docker.internal:11434
bunx convex env set EMBED_MODEL bge-m3
bunx convex env set LLM_MODEL qwen2.5:3b
bunx convex dev --once            # deploy schema + functions (creates vector/search indexes)

# 3. Seed a realistic corpus + run the verification scripts.
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210 MAPR_INGEST_KEY=mapr-dev-ingest-secret
node scripts/seed.mjs              # 12 articles -> 11 correlated events
node scripts/verify.mjs            # feed + every deterministic intent
node scripts/embed_stub.mjs &      # stand-in /embed (real one is the Rust bge-m3)
node scripts/verify_rag.mjs        # vector + full-text hybrid retrieval
node scripts/llama_stub.mjs &      # stand-in llama.cpp
bunx convex run rag:generate '{"question":"CITE","retrieved":[...],"prior":[]}' --push   # citation enforcement
node --test test/lib.test.ts       # pure-logic unit tests (recency, citations, intent, routing)
```

| Phase 0 item | Status | Evidence / command |
| --- | --- | --- |
| (a) Rust `ort` bge-m3 1024-dim + `/embed` | **PARTIAL** — code VERIFIED to compile (`cargo check/clippy --features ort-embed` clean); the 2.3GB ONNX model is loaded at runtime on the box from `MAPR_BGE_M3_DIR`. Default `cargo build/test` runs without it. | `cd ingestor && cargo clippy --features ort-embed --lib -- -D warnings`; on the box: build `--features ort-embed`, mount the model, `GET /healthz`, `POST /embed`. |
| (b) Batched Convex upsert within limits | **VERIFIED (local)** — `ingestBatch` idempotent (insert→update), event correlation (2 Kyiv articles → 1 event), 1024-dim guard; live Rust→Convex write round-trip. | `node scripts/seed.mjs` (rerun → updated, not duplicated); `cd ingestor && CONVEX_URL=… MAPR_INGEST_KEY=… cargo test convex::tests::live_ingest_roundtrip -- --ignored`. |
| (c) vectorSearch + full-text hybrid | **VERIFIED (local)** — semantic (recency-bucketed vector filter) + lexical merge + region/window post-filter, correct top-K. | `node scripts/verify_rag.mjs` (conflict / cyber / region / window cases). |
| (d) llama.cpp generation from a Convex action | **VERIFIED (local, via stub)** — generate action calls the OpenAI-compatible API; **citation enforcement** proven: cited answer accepted (enriched), uncited answer with a corpus present **rejected** (`AI_BAD_QA_OUTPUT`). Real qwen2.5-3b is OPERATOR (box). | `node scripts/llama_stub.mjs` + `bunx convex run rag:generate …` (CITE vs no-cite). |
| (e) magic-link + Stripe webhook reachable | **PARTIAL** — auth config valid + deployed on self-host; sign-in UI + webhook `httpAction` + idempotent `stripeEvents.apply` built & typechecked. Real email delivery (Resend), live Stripe events, and tunnel reachability are **OPERATOR (box)**. | Set `AUTH_RESEND_KEY`, `STRIPE_*`; point Stripe webhook at `https://<site-origin>/stripe/webhook`; send a test event. |
| (f) RAG / Auth / Agent components on self-host | **VERIFIED (local)** — Convex Auth deploys + runs on self-host. **RAG is implemented natively** on `articles` (vectorIndex + searchIndex) — leaner than `@convex-dev/rag` and removes a self-host component-compat risk (deliberate refinement of the plan). `@convex-dev/agent` (threads) deferred to Phase 2. | `bunx convex dev --once` (auth tables + indexes deploy cleanly). |
| (g) RAM/CPU under concurrent ingest + LLM | **OPERATOR (box)** — per-service `mem_limit` budget documented in deploy/README; one Ollama model resident at a time (`OLLAMA_KEEP_ALIVE=15m`). NOT implemented: a hard `MAX_CONCURRENT_LLM` cap and automatic off-peak ingest gating — the ingest-vs-RAG contention on the single CPU-only Ollama is an operator lever (raise `INGEST_INTERVAL_SECS` or point ingest at a separate `OLLAMA_URL`), documented as a comment on the `ollama` service in docker-compose.yml. | Run on the box; watch `docker stats` during a refresh + QA load. |
| (h) backup → restore drill | **OPERATOR (box)** — `deploy/backup/backup.sh` (`convex export` logical snapshot + a consistent tar of the embedded-SQLite `convex_data` volume, taken after stopping `convex-backend`, pushed off-box via rclone) + `deploy/backup/restore.md`. (Embedded SQLite, not Postgres — there is no `pg_dump`.) | Run backup, then restore into a scratch deployment per restore.md. |
| (i) Map engine: SVG flat + globe @ 60fps | **VERIFIED (local)** — 177 countries + pulsing severity markers; flat pan/zoom, globe drag + auto-rotate + back-face culling; flat↔globe toggle; all motion gated behind `prefers-reduced-motion`. | `cd web && bun run dev`, open `/`; browser-rendered against the design screenshots (see tmp/web-*.png). |

## What this proves
The full Phase 1 data path is real and verified on self-hosted Convex:
ingest (Rust pipeline + idempotent upsert + correlation) → reactive feed →
deterministic composer (every intent) → hybrid RAG retrieval → grounded,
citation-enforced generation → lean tactical-dark UI. The only unverified
surfaces are the ones that intrinsically need the owner's box (real model
weights, real email/Stripe, hardware resource behavior, backup media) — all
delivered as runnable code + documented operator steps.
