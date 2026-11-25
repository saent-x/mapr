# MAPR v2: handoff (2026-11-22)

Read this first when picking the work up in a Claude Code terminal. Branch `claude/project-thread-2c1zbj`, draft PR #38 (saent-x/mapr). Everything new lives under `v2/`.

## Goal

Rebuild MAPR (live OSINT watch desk: feeds → events → map-first console with AI search and live updates) from scratch at **mapr.stbrn.studio**, as an stbrn studio product.

## Rules (decided by tor)

- **Cost:** while testing, MAPR must add **$0** to the Cloudflare bill (shared $5/mo Workers Paid plan). Heavy and growing work (ingest, embeddings, DB) runs on tor's server **stbrn-studios**.
- **Scope:** keep all 382 feeds, AI search and live updates. No quality-reducing fallbacks (no keyword-only or rule-based scoring when caps hit). Cut retention instead.
- **Keep facts, not articles:** article text 72h, article metadata 7d, events + vectors 30d (unless saved to a case; was 90d until 2026-11-22).
- **Budget gate:** AI jobs pause when the account reaches 9,000 Workers AI neurons/day and resume at 00:00 UTC. Nothing is skipped or downgraded.
- **Design (v4, 2026-11-25):** "field atlas": ink on paper, stippled land, hairline square panels, one blue `signal` accent for anything live, yellow `flash` for the newest event only. Geist + Geist Mono. Paper and Night themes. No taglines, helper text or secondary labels; fix the layout instead. Design system and prototype in `/mnt/project-files/mapr-design-v4/`. Built in `v2/web/src/client` (globe.ts, flat.ts, main.ts, atlas.css).
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
| Map | three.js globe + d3 Equal Earth sheet on a bundled Natural Earth 1:110m basemap; no tiles, no third-party requests |
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

## State on the server (last check 2026-10-26 20:10 UTC)

- db, ingestor and embedder up 2 days, all healthy. 62,852 articles in, 0 waiting. 33,731 events. `/data` at 16 GB; root `/` 2.2 GB free.
- `.env` has `EMBED_MODEL_ID=BAAI/bge-m3`; `compose.override.yml` sets `CLUSTER_THRESHOLD=0.71` (now the repo default too, so the override can go).
- 2026-10-26: server synced to the branch (rsync, not git) and redeployed. Workers AI token saved, `CF_ACCOUNT_ID` set, triage running. 14,749 queued jobs for events older than 48h dropped; triage now skips events that age past 48h in the queue. `compose.override.yml` retired (backup at `/data/mapr/src/compose.override.yml.bak`). Steps 1, 2 and 6 below are done.

## Next steps

Done: Workers AI token + `CF_ACCOUNT_ID` (1), server synced and redeployed with triage running (2), stall warning (6). KV namespace `mapr-snapshot` created (2026-11-17) and wired into `v2/web/wrangler.jsonc`.

3. **Tunnel:** done 2026-11-21. Tunnel `mapr-ai` (locally managed, so the dashboard cannot add routes) runs as the `tunnel` compose service with its token in `/data/mapr/secrets/tunnel_token`; the hostname rule is `v2/deploy/stbrn-studios/tunnel.yml`. DNS once from the Mac: `cloudflared tunnel route dns mapr-ai mapr-api.stbrn.studio`. Check: `curl -s -o /dev/null -w '%{http_code}' https://mapr-api.stbrn.studio/healthz` gives 200.
4. **Deploy the Worker:** done 2026-11-21 at `mapr.stbrn-studios.workers.dev` (INGEST_TOKEN secret set). The desk keeps relevant events only (source cap 6, 20 MiB size guard). 2026-11-22 (88d211e): triage paced over the day under the 9,000 ceiling, events with more sources first, microsecond cursor, no KV write when nothing changed. Roll out: sync to the server + `deploy.sh`, then `npx wrangler deploy`. 2026-11-22: `mapr.stbrn.studio` custom domain enabled in `wrangler.jsonc` (workers.dev kept on).
   - Open: the budget counts only MAPR's own neurons, not other projects on the account (no account-wide reader yet). At $0, about 3k events/day get scored (all multi-source + newest single-source); scoring all would be ~$6.5/mo. `/data` grew to 26 GB (16 GB in Oct): find out why.
5. Check Cloudflare vs local bge-m3 vectors match (cosine ≈ 1) before turning on `EMBED_PROVIDER=cloudflare`.
7. Later: watches + Clef matching, Clairic facts, D1 auth (Better Auth), alert email, AI search answers, real analysis charts.
8. **Open decisions for tor:** pricing / revenue model (see `revenue-review.md`) and the AI budget for answers and briefs.

## Running locally

```bash
cd v2/server && pnpm i && pnpm test:unit       # unit tests
pnpm test                                      # unit + integration (needs Docker running)
cd v2/embedder && pip install -r requirements-dev.txt && pytest
cd v2/web && pnpm i && pnpm test && pnpm dev   # desk at localhost:8787
```
