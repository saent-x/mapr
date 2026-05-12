# Mapr AI sidecar — Coolify deploy

This directory deploys the **AI inference service** (the `/embed`, `/ner`,
`/generate` endpoints used by `server/ai/client.js`) onto your home PC via
[Coolify](https://coolify.io). Coolify manages the containers, restarts,
logs, environment, and Cloudflare Tunnel for you.

## Stack at a glance

| Container     | Role                                                          | RAM    |
| ------------- | ------------------------------------------------------------- | ------ |
| `ollama`      | Local LLM runtime — serves Qwen 2.5 3B Q4 on `:11434`         | ~3 GB  |
| `model-puller`| One-shot init: `ollama pull qwen2.5:3b-instruct-q4_K_M`       | tiny   |
| `ai-worker`   | FastAPI: `/embed` (bge-m3) + `/ner` (GLiNER) + `/generate`    | ~1.5 GB|
| `cloudflared` | Cloudflare Tunnel publishing the worker to your domain        | ~50 MB |

Total CPU steady-state ≈ 80–120 W peak; embeddings + brief calls share the
same threads. Comfortable on a 24 GB CPU-only box.

## Prerequisites

1. **Coolify v4** running on the home PC (the host with 24 GB RAM).
2. **A domain** you can point at Cloudflare (Cloudflare manages DNS).
3. **Cloudflare Zero Trust** account — free tier is plenty.

## Step 1 — Create the Cloudflare Tunnel

1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → **Create tunnel**.
2. Pick **Cloudflared**. Name it `mapr-ai`.
3. Copy the **tunnel token** (long string starting with `eyJ…`). You will
   paste it into Coolify as `CF_TUNNEL_TOKEN`.
4. Under **Public Hostnames**, add **two** entries pointing at the worker
   container's internal address:

   | Subdomain | Domain         | Service               |
   | --------- | -------------- | --------------------- |
   | `ai-llm`  | your-domain.com| `http://ai-worker:8080` |
   | `ai-embed`| your-domain.com| `http://ai-worker:8080` |

   Both subdomains land on the same container; the Mapr server uses
   distinct hostnames so future scaling (split LLM vs embed) is one
   tunnel-routing change rather than a code change.

5. Under **Access → Applications**, add a service-token-protected app for
   each hostname. Generate one **service token** (used by the Mapr server)
   and save the **Client ID** and **Client Secret**.

## Step 2 — Deploy on Coolify

1. Coolify → your project → **New Resource → Service → Docker Compose**.
2. Source: paste this repo's URL and set the **base directory** to `home-pc`.
3. Open **Environment Variables** and set:

   | Variable            | Value                                                     |
   | ------------------- | --------------------------------------------------------- |
   | `MAPR_AI_BEARER`    | `openssl rand -hex 32` — random shared secret             |
   | `CF_TUNNEL_TOKEN`   | the tunnel token from step 1                              |
   | `OLLAMA_MODEL`      | `qwen2.5:3b-instruct-q4_K_M` (override only if you swap)  |
   | `N_THREADS`         | leave blank, or set to the physical-core count            |

4. Hit **Deploy**. Coolify builds the `ai-worker` image, pulls the Ollama
   image, runs `model-puller` once (`ollama pull` takes a few minutes the
   first time), and brings up the `cloudflared` container.
5. Verify the tunnel is **healthy** in the Cloudflare dashboard.

## Step 3 — Wire the Mapr server

Whether Mapr itself stays on Railway or also moves to Coolify, set these
environment variables on the **Mapr server**:

```
MAPR_AI_HOMEPC_LLM_URL=https://ai-llm.your-domain.com
MAPR_AI_HOMEPC_EMBED_URL=https://ai-embed.your-domain.com
MAPR_AI_HOMEPC_BEARER=<same value as MAPR_AI_BEARER>
MAPR_AI_CF_ACCESS_ID=<service-token client id>
MAPR_AI_CF_ACCESS_SECRET=<service-token client secret>

# Fallback (optional but recommended)
MAPR_AI_WORKERSAI_ACCOUNT=<your CF account id>
MAPR_AI_WORKERSAI_TOKEN=<API token with Workers AI: Read+Edit scope>
```

## Step 4 — Smoke test

Once the tunnel reports healthy, from any machine:

```bash
TOKEN=<MAPR_AI_BEARER>
CFI=<service-token client id>
CFS=<service-token client secret>

curl -fsS \
  -H "cf-access-client-id: $CFI" \
  -H "cf-access-client-secret: $CFS" \
  https://ai-embed.your-domain.com/healthz | jq .

curl -fsS -X POST \
  -H "content-type: application/json" \
  -H "x-mapr-token: $TOKEN" \
  -H "cf-access-client-id: $CFI" \
  -H "cf-access-client-secret: $CFS" \
  -d '{"inputs":["hello world"]}' \
  https://ai-embed.your-domain.com/embed | jq '.vectors | length'
```

You should see a length of `1` (one 1024-dim vector). First request takes
~10–20 seconds while the embedding model loads; subsequent calls are sub-second.

## Hosting Mapr itself on Coolify (optional)

If you also want to retire Railway, treat the Mapr server as a Coolify
**Application** (not Service):

1. **Postgres**: Coolify → New Resource → Database → **PostgreSQL 16 with
   pgvector**. Coolify exposes `DATABASE_URL` to the same project.
2. **Redis**: Coolify → New Resource → Database → **Redis 7**. (Used later
   by BullMQ in sprint C3.)
3. **Mapr server**: Coolify → New Resource → Application → point at this
   repo, build pack **Nixpacks** (the existing `nixpacks.toml` works), start
   command `node server/index.js`. Wire env vars from §3 plus
   `DATABASE_URL`, `REDIS_URL`, `INSTANT_APP_ID`, `INSTANT_ADMIN_TOKEN`,
   `RESEND_API_KEY`, `MAPR_EMAIL_FROM`, `MAPR_PUBLIC_URL`, Stripe keys, etc.

Mapr and the AI sidecar can share a Coolify project so they sit on the same
internal Docker network — no need to route LLM traffic through Cloudflare
when both run on the same host. Internal hostname is `http://ai-worker:8080`.

## Updating the model

To upgrade or swap models:

1. Coolify → Service → Environment → edit `OLLAMA_MODEL` to the new tag
   (e.g. `qwen2.5:7b-instruct-q4_K_M` if you ever move to a beefier box).
2. **Redeploy** the `model-puller` container only — it pulls the new model
   into the persistent `ollama-data` volume. The `ai-worker` doesn't need
   a rebuild; `OLLAMA_MODEL` propagates on next request.

## Resource notes

- Qwen 2.5 3B Q4_K_M on CPU: ~9–14 tok/s; a 250-token brief ≈ 20–25 s.
- BGE-M3 ONNX int8: ~200–300 docs/sec batched.
- GLiNER multi v2.1: ~50–100 headlines/sec.
- Persistent volumes:
  - `ollama-data` holds the GGUF weights (~2 GB).
  - `hf-cache` holds the HuggingFace cache for the embed + NER models (~1 GB).
- If `free -h` shows >80 % RAM under load, lower `MAX_CONCURRENT_EMBED` to
  `1` and add swap. Don't run a 7B model on this host — it'll thrash.
