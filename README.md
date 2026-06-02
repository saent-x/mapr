# MAPR — tactical OSINT command console

Live global-event intelligence: a Rust worker ingests real news feeds, enriches
(geocode / severity / NER / correlation) and embeds them, writing into a
self-hosted **Convex** backend that serves a lean React console with a bespoke
**MapLibre GL** 3D map and a grounded RAG assistant — all self-hostable from one
`docker compose`.

## Layout (monorepo)
| Dir | What |
| --- | --- |
| `convex/` | Serving/RAG/auth/realtime backend — self-hosted Convex (TS functions). Schema, queries/mutations/actions, Stripe `http.ts`, crons, Convex Auth. |
| `ingestor/` | Rust worker: fetch (GDELT/RSS/HTML, SSRF-safe) → dedup → geocode → severity → NER → correlate → embed (Ollama bge-m3) → idempotent `ingestBatch`. |
| `web/` | React 19 + Vite + `convex/react`. MapLibre GL map (flat + globe), bottom-center composer (deterministic filter + grounded RAG), region/trends/entities/intel/workspace/admin. |
| `migration/` | One-shot legacy → Convex backfill (re-embed) + Stripe relink. Reads `data/`. |
| `deploy/` | One-command self-host bundle: `docker compose up -d` → Convex + Ollama + ingestor + web + tunnel + bootstrap. See `deploy/README.md`. |
| `design-ref/` | Design + contract reference (tokens, parity checklist, Convex contract, Phase-0 verification). |
| `data/` | Legacy SQLite — the migration's historical-backfill source (only needed for the one-shot cutover; otherwise the live ingestor populates everything). |

## Quick start (production, single box)
```sh
cp deploy/.env.example deploy/.env   # fill secrets (see deploy/README.md)
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
```
Ollama auto-pulls `bge-m3` + `qwen2.5:3b`, the bootstrap deploys the Convex
functions + seeds real sources, and the ingestor begins populating live data.

## Local development
- Backend: `cd convex && bun install && bunx convex dev` (against a local
  self-hosted Convex backend — see `deploy/PHASE0-VERIFICATION.md`).
- Web: `cd web && bun install && bun run dev`.
- Ingestor: `cd ingestor && cargo run -- --once` (needs `CONVEX_URL`, `OLLAMA_URL`, `MAPR_INGEST_KEY`).

## AI / data flow
Rust ingestor → `ingestBatch` (Convex) → reactive feed. The composer parses
intents deterministically (drives the map, no LLM) or routes free-form questions
to a grounded, citation-enforced RAG action (bge-m3 retrieval + qwen2.5
generation via Ollama). One Ollama instance serves both embeddings and generation.
