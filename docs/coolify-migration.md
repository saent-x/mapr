# Mapr → home-lab Coolify migration

End-to-end playbook for moving every Mapr service off Railway and onto
your home-lab Coolify host. Target architecture:

```
  Cloudflare DNS / Tunnel
            │
            ▼
 ┌────────────────────── Coolify project: mapr ────────────────────────┐
 │                                                                      │
 │  ┌──────────────┐    ┌──────────────┐    ┌────────────────────────┐  │
 │  │  mapr-app    │◀──▶│  Postgres    │    │  AI sidecar (compose)  │  │
 │  │  (Nixpacks)  │    │  16+pgvector │    │   ollama               │  │
 │  └──────────────┘    └──────────────┘    │   ai-worker (FastAPI)  │  │
 │         ▲                                │   cloudflared          │  │
 │         │            ┌──────────────┐    └────────────────────────┘  │
 │         └──────────▶ │   Redis 7    │                                │
 │                      └──────────────┘                                │
 └──────────────────────────────────────────────────────────────────────┘
```

Everything talks over Coolify's internal Docker network. Only the public
Mapr URL and the AI tunnel are exposed externally.

---

## 0. Prereqs

- Coolify v4 running on the home-lab box, admin access.
- A Cloudflare-managed domain you control.
- The Mapr repo accessible from Coolify (HTTPS + PAT, or a Coolify
  deploy SSH key added as a GitHub deploy key).
- A backup window: the cutover involves stopping ingest for a few minutes.

## 1. Create the Coolify project

Coolify → **Add Project** → name it `mapr`. Every resource below goes
inside this project so they share an internal Docker network.

## 2. Postgres + pgvector

Coolify → New Resource → Database → **PostgreSQL**.

- **Image**: pick the pgvector-bundled variant (Coolify offers
  `pgvector/pgvector:pg16` as a built-in template — if not visible, paste
  it under "Custom Image"). Plain `postgres:16` does **not** ship the
  extension and `CREATE EXTENSION vector` will fail at boot.
- **Persistent volume**: keep the default; Coolify mounts it under its
  storage dir.
- **Backup**: enable nightly snapshots, retention 7 days.
- Copy the **internal hostname** Coolify shows (e.g. `mapr-postgres:5432`)
  and the auto-generated password.

Compose-internal `DATABASE_URL` looks like:
```
postgres://postgres:<password>@mapr-postgres:5432/postgres
```

## 3. Redis 7

Coolify → New Resource → Database → **Redis**. Same project.

Internal URL:
```
redis://default:<password>@mapr-redis:6379
```

This Redis is exclusively for BullMQ; no need for an external port.

## 4. AI sidecar (Docker Compose Service)

Coolify → New Resource → Service → **Docker Compose**.

- Source: the Mapr repo. Branch: `main`.
- Base directory: `home-pc/`. Compose file path: `docker-compose.yaml`.
- Env (set in Coolify):
  - `MAPR_AI_BEARER` = `openssl rand -hex 32`
  - `CF_TUNNEL_TOKEN` = your tunnel token
  - `OLLAMA_MODEL` = `qwen2.5:3b-instruct-q4_K_M`
  - `N_THREADS` = blank, or physical-core count

Deploy. The bundle stands up four containers:
`ollama`, `model-puller`, `ai-worker`, `cloudflared`.

Detailed steps live in `home-pc/README.md`.

## 5. Mapr Node app

Coolify → New Resource → **Application**.

- Source: the Mapr repo, branch `main`.
- Build pack: **Nixpacks** (the repo's `nixpacks.toml` configures it).
- Start command: `node server/index.js`.
- Health-check path: `/api/health/live`.
- **Network**: same Coolify project so the app can resolve
  `mapr-postgres`, `mapr-redis`, and `ai-worker` over the internal DNS.
- Expose public URL via Cloudflare Tunnel — add a public hostname for
  the Mapr app inside your tunnel config (e.g. `app.mapr.example` →
  `http://mapr-app:3030`).

### Environment variables

Set every block below in Coolify's Application → Environment:

```dotenv
# Core
PORT=3030
NODE_ENV=production
MAPR_PUBLIC_URL=https://app.mapr.example

# Postgres
DATABASE_URL=postgres://postgres:<password>@mapr-postgres:5432/postgres

# Redis
REDIS_URL=redis://default:<password>@mapr-redis:6379

# InstantDB (auth + Pro-tier per-user data)
INSTANT_APP_ID=<from instantdb dashboard>
INSTANT_ADMIN_TOKEN=<admin token>

# AI sidecar — internal hostname (skip Cloudflare for in-project traffic)
MAPR_AI_HOMEPC_LLM_URL=http://ai-worker:8080
MAPR_AI_HOMEPC_EMBED_URL=http://ai-worker:8080
MAPR_AI_HOMEPC_BEARER=<MAPR_AI_BEARER value from §4>

# Optional Cloudflare Workers AI fallback (used when ai-worker is unhealthy)
MAPR_AI_WORKERSAI_ACCOUNT=<cf account id>
MAPR_AI_WORKERSAI_TOKEN=<api token with Workers AI: Read+Edit>

# Email (alert + daily digests)
RESEND_API_KEY=<resend api key>
MAPR_EMAIL_FROM="Mapr Alerts <alerts@mapr.example>"

# Stripe billing
STRIPE_SECRET_KEY=<sk_live_or_test>
STRIPE_WEBHOOK_SECRET=<whsec_…>

# Admin
ADMIN_PASSWORD=<long random>

# Optional: silence the digest sweeps in staging
# DISABLE_DIGEST_SWEEP=true
# DISABLE_DAILY_DIGEST=true
```

Hit **Deploy**.

## 6. Data migration (Railway Postgres → Coolify Postgres)

Stop the Railway Mapr scheduler briefly to avoid mid-dump writes:

```bash
# On Railway (one-off): set a temporary env that disables ingest, or
# stop the service. Either is fine — the dump only needs a quiet minute.

# 1. Dump from Railway
RAILWAY_DB_URL="postgres://…railway…"
pg_dump --no-owner --no-privileges \
        --format=custom \
        --file mapr.dump \
        "$RAILWAY_DB_URL"

# 2. Restore into Coolify Postgres. Open a TCP tunnel into the home-lab
#    Postgres from your laptop (Coolify dashboard offers a "Connect" button
#    that gives you a temporary host:port mapping), then:
COOLIFY_DB_URL="postgres://postgres:<password>@<temporary-host>:<temporary-port>/postgres"
pg_restore --no-owner --no-privileges \
           --clean --if-exists \
           --dbname "$COOLIFY_DB_URL" \
           mapr.dump

# 3. Reset sequences (pg_restore handles this for most cases, double-check
#    SERIAL tables like refresh_history just to be safe):
psql "$COOLIFY_DB_URL" -c "SELECT setval(pg_get_serial_sequence('refresh_history','id'), MAX(id)) FROM refresh_history;"
psql "$COOLIFY_DB_URL" -c "SELECT setval(pg_get_serial_sequence('snapshot_history','id'), MAX(id)) FROM snapshot_history;"
psql "$COOLIFY_DB_URL" -c "SELECT setval(pg_get_serial_sequence('coverage_history','id'), MAX(id)) FROM coverage_history;"
```

After restore, run the schema bootstrap once so the new tables created
during the Pro upgrade (`story_threads`, `briefs`,
`credibility_explanations`, `alert_digest_state`) plus the pgvector
extension and the `embedding` column are present. Easiest path: start
the Mapr app — `ensureSchema()` runs on first DB connection and is
idempotent.

## 7. Embedding + NER backfill

Once the Mapr app is up against Coolify Postgres and the AI sidecar is
healthy:

```bash
# Inside the Coolify mapr-app container (use Coolify's terminal):
node scripts/backfill-embeddings.js          # walks all articles, batches 64
node scripts/backfill-embeddings.js --force  # force re-embed if you swap models
```

The script enqueues BullMQ jobs; the embed worker (already started by
`server/index.js` because `REDIS_URL` is set) pulls them at concurrency 4.
Expect ~2 minutes for the existing 2300-article corpus.

Verify:
```sql
SELECT count(*)              AS total,
       count(embedding)      AS embedded,
       count(DISTINCT embedding_model) AS models
  FROM articles;
```

## 8. DNS cutover

Cloudflare DNS — point `app.mapr.example` (and any other public Mapr
hostnames) at the Coolify-managed tunnel rather than the Railway URL.
After TTL drains, every request flows through the home-lab.

Hit `/api/health/live` and `/api/health/ready` from outside the LAN to
confirm.

## 9. Decommission Railway

Once the Coolify path has been serving for 48 hours without regressions:

1. Suspend the Mapr service on Railway.
2. Suspend the Railway Postgres (after taking one last dump as belt-and-suspenders).
3. Cancel the Railway project at the end of the billing cycle.

## 10. Operational notes

- **Backups**: enable Coolify's nightly Postgres snapshot to off-host
  storage (S3, Wasabi, Backblaze B2). A residential drive failure is the
  one outage that won't fix itself.
- **Updates**: Coolify auto-rebuilds when you push to `main`. Pin
  branches if you want manual control over deploys.
- **Observability**: Coolify streams container logs but doesn't ship them
  long-term. If you want >7-day retention, point `cloudflared` and the
  Mapr app at Grafana Cloud's free tier or a Loki instance hosted in
  another Coolify resource.
- **Disaster path**: if the home-lab is down >1 hour, set
  `MAPR_AI_HOMEPC_LLM_URL=` (empty) to force every AI call through
  Cloudflare Workers AI. The product survives without local embeddings
  (semantic clustering pauses, brief generation slows). Postgres + Redis
  outages still kill the app — that's the single-point-of-failure cost
  of the home-lab path.
