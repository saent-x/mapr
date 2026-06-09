<!-- deploy/README.md — ONE-COMMAND runbook for the MAPR self-hosted stack. -->
# MAPR self-hosting runbook (one command, live data)

The **whole** MAPR stack runs from a single `docker compose up -d` on the
owner's Coolify box (Core i7 class / 24 GB / 256 GB). After the secrets are
filled in once, bringing the system up is one command — models pull
themselves, the Convex functions deploy themselves, and the **live** source
catalog seeds itself.

```
internet ──► cloudflared ──► web              (nginx, static React SPA)
                         ──► convex-backend :3210  (API + reactive WebSocket)
                         ──► convex-backend :3211  (HTTP actions / Stripe / Auth)

private mapr network:
  ollama (bge-m3 + qwen2.5:3b)  ·  rust-ingestor  ·  convex-dashboard
one-shots:  ollama-pull (model puller)  ·  bootstrap (deploy + env + seed)
```

Files here: `docker-compose.yml` · `.env.example` · `nginx.conf` ·
`bootstrap/` · `cloudflared/config.example.yml` · `backup/`.

Container build inputs live with their code: `../ingestor/Dockerfile` (pure
release worker) and `../web/Dockerfile` (Vite build → nginx).

> The stack writes a working copy of `/convex` **inside** the bootstrap
> container; your host `/convex` and `/ingestor` trees are never modified.

---

## 0. Prerequisites (on the box)

- Docker Engine + Compose v2 (`docker compose version`).
- A Cloudflare account with a zone you control (for the tunnel).
- `rclone` + an off-box remote, only if you want the backup cron (optional).

Everything else (Bun, the Convex CLI, Rust, model weights) is handled inside
containers — nothing else to install.

```sh
git clone <repo> /opt/mapr && cd /opt/mapr/deploy
cp .env.example .env
```

---

## 1. Fill in `deploy/.env` (the only manual step)

Open `deploy/.env` and set the values. Generate the random secrets:

```sh
openssl rand -hex 32   # INSTANCE_SECRET
openssl rand -hex 24   # MAPR_INGEST_KEY
```

Set the three **tunnel hostnames** (created in step 5; pick them now):

- `CONVEX_CLOUD_ORIGIN` → e.g. `https://convex-api.example.com`
- `CONVEX_SITE_ORIGIN`  → e.g. `https://convex-site.example.com`
- `APP_ORIGIN`          → e.g. `https://app.example.com`

Set the **first admin(s)** — comma-separated emails. The Convex Auth callback
grants `role=admin` on the *first* sign-in of any address listed here:

```sh
ADMIN_EMAILS=you@example.com,ops@example.com
```

**Generate the Convex Auth signing keys** (`JWT_PRIVATE_KEY` + `JWKS`). This is
the one pair you cannot invent — produce both with `jose`:

```sh
docker run --rm node:22-slim bash -lc '
  npm i -s jose >/dev/null 2>&1
  node -e '\''
    import("jose").then(async ({ exportJWK, exportPKCS8, generateKeyPair }) => {
      const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
      const pkcs8 = (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " ");
      const jwks = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(publicKey)) }] });
      console.log("JWT_PRIVATE_KEY=\"" + pkcs8 + "\"");
      console.log("JWKS=" + jwks);
    });
  '\''
'
```

Copy the two printed lines verbatim into `deploy/.env` (the `JWT_PRIVATE_KEY`
value is single-line PKCS8 with newlines replaced by spaces; `JWKS` is the
matching public JWKS JSON).

**Generate the Convex admin key once** (it is deterministic from
`INSTANCE_SECRET`, so this value is stable across restarts):

```sh
docker compose -f docker-compose.yml run --rm --no-deps \
  --entrypoint ./generate_admin_key.sh convex-backend
```

Paste the printed `convex-self-hosted|...` value into `deploy/.env` as
`CONVEX_SELF_HOSTED_ADMIN_KEY`.

Fill the remaining provider secrets: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`
(set `STRIPE_WEBHOOK_SECRET` later in step 4 once the endpoint exists).
`AUTH_RESEND_KEY`/`AUTH_EMAIL_FROM` are OPTIONAL (only the daily-digest email
uses them; auth is email + password). `EMBED_MODEL=bge-m3` and
`LLM_MODEL=qwen2.5:3b` are correct defaults — leave them.

---

## 2. Bring up the whole stack — one command

```sh
docker compose -f docker-compose.yml --env-file .env up -d
```

That's it. In dependency order, Compose then:

1. starts **convex-backend** (embedded SQLite on the `convex_data` volume),
   waits for `GET /version`;
3. starts **ollama**, then the **ollama-pull** one-shot pulls `bge-m3`
   (1024-dim embeddings) and `qwen2.5:3b` (LLM) into the `ollama_models` volume
   — the first pull downloads ~3–4 GB and takes a few minutes;
4. runs the **bootstrap** one-shot: `convex deploy` the functions, `convex env
   set` every function var, then seeds the **live** source catalog
   (`ingest:seedSources`);
5. starts **rust-ingestor** (only after backend + ollama + models + bootstrap
   are ready) — it begins fetching, enriching, embedding and writing events;
6. starts **web** (nginx) and **cloudflared**.

Watch progress:

```sh
docker compose -f docker-compose.yml logs -f bootstrap ollama-pull rust-ingestor
docker compose -f docker-compose.yml ps        # steady-state services healthy
```

The bootstrap and ollama-pull containers **exit 0** when done — that is normal
(`restart: "no"`). Re-running `up` re-runs them idempotently.

---

## 3. What ran automatically

- **Models**: `ollama-pull` pulled `bge-m3` + `qwen2.5:3b`. They persist in the
  `mapr_ollama_models` volume; subsequent boots skip the download.
- **Functions + env**: `bootstrap` deployed `/convex/functions` to the
  self-hosted backend and applied every Convex *function* env var (Ingest /
  Ollama / Auth / JWT / Stripe). `CONVEX_SITE_URL` + `CONVEX_CLOUD_URL` (read by
  `auth.config.ts`) are injected by the backend from
  `CONVEX_SITE_ORIGIN`/`CONVEX_CLOUD_ORIGIN` — never set by hand.
- **Live sources**: `bootstrap` seeded the default SSRF-safe news feeds, so the
  ingestor has real sources to fetch on its first cycle.

---

## 4. Wire Stripe (after the tunnel is live — see step 5)

Create the Stripe webhook endpoint pointing at the **site** origin:

- URL: `https://<CONVEX_SITE_ORIGIN>/stripe/webhook`
  (e.g. `https://convex-site.example.com/stripe/webhook`)
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`.

Copy the signing secret into `deploy/.env` as `STRIPE_WEBHOOK_SECRET`, then
re-run the bootstrap one-shot to push it onto the deployment:

```sh
docker compose -f docker-compose.yml up -d --force-recreate bootstrap
```

---

## 5. Cloudflare Tunnel (the only public ingress)

Follow the header of [`cloudflared/config.example.yml`](./cloudflared/config.example.yml):

```sh
cloudflared tunnel login
cloudflared tunnel create mapr                       # prints <TUNNEL_ID>
cp ~/.cloudflared/<TUNNEL_ID>.json cloudflared/<TUNNEL_ID>.json
cp cloudflared/config.example.yml cloudflared/config.yml   # fill <TUNNEL_ID> + hostnames
cloudflared tunnel route dns mapr app.example.com
cloudflared tunnel route dns mapr convex-api.example.com
cloudflared tunnel route dns mapr convex-site.example.com
```

The three public hostnames MUST equal `APP_ORIGIN`, `CONVEX_CLOUD_ORIGIN`,
`CONVEX_SITE_ORIGIN`. Cloudflare terminates TLS; the internal services stay
plain HTTP on the private network.

> The web bundle bakes the Convex origins in at build time. If you change the
> hostnames later, rebuild: `docker compose -f docker-compose.yml build web`.

> **cloudflared is pinned to a known-good tag** (`cloudflare/cloudflared:2026.5.2`)
> rather than `:latest`, so an auto-pulled bad build can't silently break the
> only ingress. Bump it deliberately after checking the
> [cloudflared releases](https://github.com/cloudflare/cloudflared/releases).

### Break-glass: tunnel down

The named tunnel is the **single, un-redundant** public ingress. If it (or
Cloudflare) is down and you need MAPR reachable *now*, use one of these
**temporary** paths — both expose the loopback ports the stack already binds
(`8080` web, `3210/3211` convex). Tear them down once the named tunnel is back.

```sh
# A. Cloudflare quick tunnel — instant random *.trycloudflare.com URL, no DNS,
#    no account config. Run on the box, one per port you need to expose:
cloudflared tunnel --url http://localhost:8080     # the web SPA
cloudflared tunnel --url http://localhost:3210     # convex API (if needed)
# Each prints a https://<random>.trycloudflare.com you can hit immediately.

# B. SSH reverse tunnel — forward the box's loopback ports out to any host you
#    can SSH to (e.g. a jump VPS), then reach them via that host:
ssh -N -R 8080:localhost:8080 -R 3210:localhost:3210 user@jump-host
```

Quick tunnels and SSH forwards are **not** a permanent fix: they have no custom
hostname, no TLS pinning, and the quick-tunnel URL changes on every restart.
Restore the named tunnel (step 5) as soon as possible.

---

## 6. First admin login

Open `https://app.example.com` and **create an account** (email + password)
with an address listed in `ADMIN_EMAILS`. The auth callback grants that account
`role=admin` on first sign-in. Admins get the **Admin** page to manage the
source catalog (see below) and view source health.

Smoke test the round trip:

```sh
# Backend reachable through the tunnel:
curl -s https://convex-api.example.com/api/query \
  -H 'content-type: application/json' \
  -d '{"path":"events:list","args":{},"format":"json"}'
```

Then run a QA question in the app — it exercises `rag.retrieve` → Ollama
`/api/embed` (bge-m3) → vector search → `rag.generate` → Ollama
`/v1/chat/completions` (qwen2.5:3b) — and complete a Stripe test checkout to
confirm the webhook flips the user to Pro.

---

## Managing sources

Sources are the `sourceCatalog` table; the ingestor fetches every **enabled**
row each cycle.

- **In-app (admins)**: the **Admin** page has an *Add source* form (name / URL /
  kind = `rss` | `gdelt` | `html`), per-row enable/disable, and remove. Backed
  by `admin.addSource` / `admin.setSourceEnabled` / `admin.removeSource`
  (all `requireAdmin`-gated).
- **Force a refresh**: the ingestor polls a refresh signal and also runs every
  `INGEST_INTERVAL_SECS` (default 900s / 15 min).
- The default seed is a curated set of public, SSRF-safe feeds; add your own
  through the Admin page — no redeploy needed.

---

## Resource budget (24 GB box)

| Service | `mem_limit` | Notes |
| --- | --- | --- |
| convex-backend | 3 GB | API + HTTP actions + reactivity + SQLite store |
| convex-dashboard | 512 MB | admin UI (loopback) |
| ollama | 8 GB | bge-m3 (~1.2 GB) + qwen2.5:3b (~2 GB) resident |
| rust-ingestor | 512 MB | pure worker (no in-process ML) |
| web (nginx) | 128 MB | static SPA |
| cloudflared | 128 MB | tunnel |
| **Steady-state total** | **~12.3 GB** | leaves ~11 GB for OS + page cache |

One-shots (`ollama-pull`, `bootstrap`) run briefly and exit, so they don't add
to the resident budget. Ollama serves one model at a time
(`OLLAMA_KEEP_ALIVE=15m`), keeping the box at one LLM generation / embed batch
under load.

---

## Backups & restore

Daily off-box backup (`convex export` logical snapshot + a tar of the
`convex_data` SQLite volume → rclone). Configure the remote and add the cron
line from [`backup/backup.sh`](./backup/backup.sh):

```sh
chmod +x backup/backup.sh
RCLONE_REMOTE=s3:mapr-backups ./backup/backup.sh     # one-off test
```

Restore drill: [`backup/restore.md`](./backup/restore.md).

---

## HA caveat & the lift path

This is a **single home/box** deployment: **no redundancy**. A disk failure,
power loss, or kernel panic takes MAPR offline until the box recovers.
Mitigations: healthchecks + `restart: unless-stopped`, daily off-box backups,
and the restore drill above. RPO ≤ 24 h, RTO minutes (dump) to ~30 min
(re-deploy + import).

When you outgrow one box, **the app code does not change** — only where Convex
runs:

- **Lift to managed Convex Cloud** (recommended): create a Cloud deployment,
  `npx convex import --replace` the latest `convex-snapshot.zip`, set the same
  function env on it (`CONVEX_DEPLOY_KEY` + `npx convex deploy`). Re-point
  `CONVEX_CLOUD_ORIGIN`/`CONVEX_SITE_ORIGIN` (rebuild `web`) and the Stripe
  webhook at the Cloud site origin. Drop `convex-*` + `bootstrap` from this
  compose; keep `ollama` + `rust-ingestor` + `web` and point
  `rust-ingestor`'s `CONVEX_URL` at the Cloud API.
- **Lift to a bigger VPS**: identical compose; move the named volumes (or
  restore from backup) and re-create the tunnel. No code changes.

Either path uses the same `/convex` functions and the same frozen contract — the
self-hosted box and a managed deployment are interchangeable backends.
