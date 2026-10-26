# MAPR v2: handoff (2026-10-26)

Read this first when picking the work up in a Claude Code terminal. Branch `claude/project-thread-2c1zbj`, draft PR #38 (saent-x/mapr). Everything new lives under `v2/`.

## Goal

Rebuild MAPR (live OSINT watch desk: feeds → events → map-first console with AI search and live updates) from scratch at **mapr.stbrn.studio**, as an stbrn studio product.

## Rules (decided by tor)

- **Cost:** while testing, MAPR must add **$0** to the Cloudflare bill (shared $5/mo Workers Paid plan). Heavy and growing work (ingest, embeddings, DB) runs on tor's server **stbrn-studios**.
- **Scope:** keep all 382 feeds, AI search and live updates. No quality-reducing fallbacks (no keyword-only or rule-based scoring when caps hit). Cut retention instead.
- **Keep facts, not articles:** article text 72h, article metadata 7d, events + vectors 90d (unless saved to a case).
- **Budget gate:** AI jobs pause when the account reaches 9,000 Workers AI neurons/day and resume at 00:00 UTC. Nothing is skipped or downgraded.
- **Design:** "Instrument" colours on the dense watch-desk layout. No blue accent. No taglines, helper text or secondary labels; fix the layout instead. Tokens in `/mnt/project-files/mapr-design/` (copy also in the canvas artifact). Analysis charts are placeholders.
- **Git:** commit as `Vangerwua Tor <45785419+saent-x@users.noreply.github.com>`. Never add Claude as author, co-author or any attribution line.
- **Secrets:** never paste tokens in chat. They go straight into files on the server under `/data/mapr/secrets/`.

## Key decisions

| Topic | Decision |
| --- | --- |
| Stack | TS ingestor + Python embedder + Postgres (ParadeDB 0.26.3-pg18: pgvector + BM25) on the server; Cloudflare Worker + Durable Object + KV for the desk; D1 only for users/watches/billing (later) |
| Embeddings | **BAAI/bge-m3**, picked by bake-off on the server: grouping F1 0.881 (Qwen3 0.892), non-English recall@10 0.909 (Qwen3 0.899), **8.4 docs/s vs 0.4** on the server CPU. Runs locally at $0; Workers AI also hosts `@cf/baai/bge-m3`, so `EMBED_PROVIDER=cloudflare` can route there while the budget is open, with the same model locally as backup |
| Clustering | `CLUSTER_THRESHOLD=0.71` (tuned for bge-m3) |
| Triage | Clef-flash (`@cf/cloudflare/clef-flash`): relevant (yes/no), category (10 types), severity (4 levels). Only events newer than 48h are triaged |
| Later AI | Clef for watch matching; Clairic (preview) for typed facts on alerted events; Claude via AI Gateway for answers/briefs, capped |
| Map | MapLibre 5.24 + OpenFreeMap tiles (free, no key), 2D/3D globe toggle, bundled Natural Earth outline as fallback so the map is never blank |
| Server access | Only through tor's Mac (`ssh stbrn-studios`). Server root `/` is nearly full: everything goes under `/data/mapr/{src,pg,secrets,models}` |

Full plan: `/mnt/project-files/mapr-review/lean-architecture.md` (its embeddings row still says harrier; bge-m3 replaced it). Reviews and revenue notes are in the same folder.

## What is built (all on the PR branch)

| Path | What |
| --- | --- |
| `v2/db/migrations` | Postgres schema (events, articles, bands, polls, activity, ai_usage) |
| `v2/sources` | The 382 feeds |
| `v2/server` | Ingestor: poll, dedup, embed, cluster, budget gate, Clef triage, Workers AI embedder + router, `/v1/events` with stable cursor. 176 unit tests + integration tests (need Docker) |
| `v2/embedder` | FastAPI + sentence-transformers service on 127.0.0.1:8788, bake-off tooling and dataset |
| `v2/deploy/stbrn-studios` | `compose.yml` + `deploy.sh` (db, ingestor, embedder; uids 50999/10001 because host uid 999 is caddy) |
| `v2/web` | Cloudflare Worker: cron pulls events into a 24h KV snapshot, LiveHub Durable Object pushes over WebSockets, desk UI with the map |

Previews: `/mnt/project-files/mapr-v2/desk-*.png`.

## State on the server (last check 2026-10-24 05:09 UTC)

- db, ingestor and embedder running. 14,377 articles in, 0 waiting. 10,786 events, 757 with 2+ sources. `/data` at 14 GB.
- `.env` has `EMBED_MODEL_ID=BAAI/bge-m3`; `compose.override.yml` sets `CLUSTER_THRESHOLD=0.71` (now the repo default too, so the override can go).
- **The server's code is older than the branch:** no Cloudflare embedder, no Clef triage, no cursor fix. About 8,000 triage jobs are queued and idle.

## Next steps

1. **tor:** create a Workers AI API token. Save it on the server to `/data/mapr/secrets/cf_api_token` (mode 400, owner 50999) and set `CF_ACCOUNT_ID` in the server `.env`. Never in chat.
2. **Sync the server to the branch** (`git pull` in `/data/mapr/src`), then `v2/deploy/stbrn-studios/deploy.sh`. Triage starts; the budget gate spreads the backlog over days. Consider dropping queued jobs for events older than 48h first.
3. **Cloudflare Tunnel:** `cloudflared tunnel login` (tor), then a tunnel from a hostname to `127.0.0.1:8787`.
4. **Deploy the Worker** (`v2/web`): `wrangler kv namespace create SNAPSHOT` and put the id in `wrangler.jsonc`, set `INGEST_URL` to the tunnel hostname, `wrangler secret put INGEST_TOKEN` (the ingestor's `api_token` from `/data/mapr/secrets/`), `wrangler deploy`. Then enable the `mapr.stbrn.studio` route.
5. Check Cloudflare vs local bge-m3 vectors match (cosine ≈ 1) before turning on `EMBED_PROVIDER=cloudflare`.
6. Small fix: warn clearly when the embedder stops answering (it stalled once with no log).
7. Later: watches + Clef matching, Clairic facts, D1 auth (Better Auth), alert email, AI search answers, real analysis charts.
8. **Open decisions for tor:** pricing / revenue model (see `revenue-review.md`) and the AI budget for answers and briefs.

## Running locally

```bash
cd v2/server && pnpm i && pnpm test:unit       # unit tests
pnpm test                                      # unit + integration (needs Docker running)
cd v2/embedder && pip install -r requirements-dev.txt && pytest
cd v2/web && pnpm i && pnpm test && pnpm dev   # desk at localhost:8787
```
