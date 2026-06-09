#!/usr/bin/env bash
# deploy/bootstrap/bootstrap.sh
# One-shot deploy step for the MAPR self-hosted stack. After convex-backend is
# healthy this:
#   1. validates the admin key,
#   2. waits for the backend HTTP API,
#   3. writes /convex/.env.local (CONVEX_SELF_HOSTED_URL + ADMIN_KEY),
#   4. `convex deploy` the functions in /convex,
#   5. `convex env set` every function env (idempotent; empty values skipped),
#   6. seeds the LIVE source catalog via POST /api/mutation ingest:seedSources.
# Idempotent + tolerant: safe to re-run on every `docker compose up`.
set -euo pipefail

CONVEX_URL="${CONVEX_SELF_HOSTED_URL:-http://convex-backend:3210}"
ADMIN_KEY="${CONVEX_SELF_HOSTED_ADMIN_KEY:-}"

log() { echo "[bootstrap] $*"; }

# --- 1. Require a real admin key -------------------------------------------
if [ -z "$ADMIN_KEY" ] || printf '%s' "$ADMIN_KEY" | grep -qi 'change-me'; then
  log "FATAL: CONVEX_SELF_HOSTED_ADMIN_KEY is not set in deploy/.env."
  log "The key is deterministic from INSTANCE_SECRET. Generate it once with:"
  log "  docker compose -f deploy/docker-compose.yml run --rm --no-deps \\"
  log "    --entrypoint ./generate_admin_key.sh convex-backend"
  log "Put the printed value in deploy/.env as CONVEX_SELF_HOSTED_ADMIN_KEY and re-run."
  exit 1
fi

# --- 2. Wait for the backend HTTP API --------------------------------------
log "waiting for convex-backend at ${CONVEX_URL} ..."
ready=0
for _ in $(seq 1 60); do
  if bun -e "fetch('${CONVEX_URL}/version').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    ready=1
    break
  fi
  sleep 3
done
if [ "$ready" -ne 1 ]; then
  log "FATAL: convex-backend did not become reachable in time."
  exit 1
fi
log "backend is up"

# --- 3. Writable working copy of /convex + .env.local ----------------------
# /convex-src is mounted read-only; copy it so we never mutate the host tree.
mkdir -p /convex
cp -a /convex-src/. /convex/
rm -rf /convex/node_modules
cd /convex
printf 'CONVEX_SELF_HOSTED_URL=%s\nCONVEX_SELF_HOSTED_ADMIN_KEY=%s\n' \
  "$CONVEX_URL" "$ADMIN_KEY" > .env.local
log "wrote /convex/.env.local"

# --- 4. Install deps + deploy functions ------------------------------------
log "installing convex deps"
bun install --frozen-lockfile || bun install
log "deploying convex functions"
bunx convex deploy -y

# --- 5. Set Convex function env (idempotent; skip empties) -----------------
seten() {
  local name="$1" value="${2:-}"
  if [ -z "$value" ]; then
    log "skip env ${name} (empty)"
    return 0
  fi
  bunx convex env set "$name" "$value" >/dev/null
  log "set env ${name}"
}

seten MAPR_INGEST_KEY       "${MAPR_INGEST_KEY:-}"
seten OLLAMA_URL            "${OLLAMA_URL:-http://ollama:11434}"
seten EMBED_MODEL           "${EMBED_MODEL:-bge-m3}"
seten LLM_MODEL             "${LLM_MODEL:-qwen2.5:3b}"
seten APP_ORIGIN            "${APP_ORIGIN:-}"
seten AUTH_RESEND_KEY       "${AUTH_RESEND_KEY:-}"
seten AUTH_EMAIL_FROM       "${AUTH_EMAIL_FROM:-}"
seten ADMIN_EMAILS          "${ADMIN_EMAILS:-}"
seten STRIPE_SECRET_KEY     "${STRIPE_SECRET_KEY:-}"
seten STRIPE_WEBHOOK_SECRET "${STRIPE_WEBHOOK_SECRET:-}"
seten STRIPE_PRICE_PRO      "${STRIPE_PRICE_PRO:-}"
seten JWT_PRIVATE_KEY       "${JWT_PRIVATE_KEY:-}"
seten JWKS                  "${JWKS:-}"
seten OLLAMA_BEARER         "${OLLAMA_BEARER:-}"
seten MAPR_QA_MAX_TOKENS    "${MAPR_QA_MAX_TOKENS:-}"

# --- 6. Seed the LIVE source catalog (idempotent mutation) -----------------
log "seeding source catalog (ingest:seedSources)"
SEED_URL="${CONVEX_URL}" SEED_KEY="${MAPR_INGEST_KEY:-}" bun -e '
const url = process.env.SEED_URL + "/api/mutation";
const ingestKey = process.env.SEED_KEY;
if (!ingestKey) { console.error("[bootstrap] no MAPR_INGEST_KEY; cannot seed"); process.exit(1); }
const body = JSON.stringify({ path: "ingest:seedSources", args: { ingestKey }, format: "json" });
const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
const text = await res.text();
if (!res.ok) { console.error("[bootstrap] seed HTTP error", res.status, text); process.exit(1); }
let parsed; try { parsed = JSON.parse(text); } catch { parsed = null; }
if (parsed && parsed.status === "error") { console.error("[bootstrap] seed function error:", parsed.errorMessage || text); process.exit(1); }
console.log("[bootstrap] seed result:", text);
'

log "done — functions deployed, env set, sources seeded."
