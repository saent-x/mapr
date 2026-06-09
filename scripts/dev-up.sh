#!/usr/bin/env bash
# dev-up.sh — bring the LOCAL mapr runtime up with live data.
#
# Idempotent: safe to re-run. It (1) ensures the convex-mapr, ollama and
# convex-dashboard containers are running, (2) builds (if needed) and
# (re)starts the Rust ingestion worker against live RSS sources, and
# (3) prints the access URLs.
#
# This is the LOCAL DEV path only. It deliberately does NOT touch
# deploy/docker-compose.yml (the production tunnel/nginx stack).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- tunables (match the running deployment) -------------------------------
CONVEX_URL="http://127.0.0.1:3210"
OLLAMA_URL="http://127.0.0.1:11434"
DASHBOARD_PORT="6791"
EMBED_MODEL="bge-m3"
INGEST_INTERVAL_SECS="900"
INGESTOR_BIN="$REPO_ROOT/ingestor/target/release/mapr-ingestor"
INGESTOR_LOG="$REPO_ROOT/ingestor/ingestor.log"

log() { printf '\033[1;36m[dev-up]\033[0m %s\n' "$*"; }

# container_up NAME -> 0 if running
container_up() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]; }
# container_exists NAME -> 0 if present (any state)
container_exists() { docker inspect "$1" >/dev/null 2>&1; }

# ensure_started NAME: start an existing-but-stopped container.
ensure_started() {
  local name="$1"
  if container_up "$name"; then
    log "$name already running"
  elif container_exists "$name"; then
    log "starting existing container $name"
    docker start "$name" >/dev/null
  else
    return 1   # caller must create it
  fi
}

# --- 0. core backend (Convex) ----------------------------------------------
ensure_started convex-mapr || { echo "ERROR: convex-mapr container missing — create it first" >&2; exit 1; }

# --- 1. Ollama: native macOS app on the GPU (Metal) ------------------------
# Docker on macOS has no GPU, so the container ollama is CPU-only and too slow
# for RAG generation (the 60s timeout fires). Use the native Ollama.app (GPU),
# bound to 0.0.0.0 so Convex reaches it via host.docker.internal. A container
# ollama would collide on :11434 — stop it if present.
if container_up ollama; then
  log "stopping CPU container ollama (using native GPU Ollama.app instead)"
  docker stop ollama >/dev/null 2>&1 || true
fi
launchctl setenv OLLAMA_HOST "0.0.0.0:11434" 2>/dev/null || true
if ! pgrep -f 'Ollama.app' >/dev/null 2>&1; then
  log "launching native Ollama.app (GPU) on 0.0.0.0:11434"
  open -a Ollama || { echo "ERROR: native Ollama.app not found — install Ollama for macOS" >&2; exit 1; }
fi
log "waiting for ollama at $OLLAMA_URL ..."
for _ in $(seq 1 30); do curl -fsS -m 3 "$OLLAMA_URL/api/tags" >/dev/null 2>&1 && break; sleep 1; done
# Ensure both models are present (idempotent — pulls only when missing).
for m in qwen2.5:3b bge-m3; do
  OLLAMA_HOST=127.0.0.1:11434 ollama show "$m" >/dev/null 2>&1 || { log "pulling $m"; OLLAMA_HOST=127.0.0.1:11434 ollama pull "$m"; }
done

# --- 2. convex admin dashboard (create on first run) -----------------------
if ! ensure_started convex-dashboard; then
  log "creating convex-dashboard container"
  docker run -d --name convex-dashboard --restart unless-stopped \
    -p "127.0.0.1:${DASHBOARD_PORT}:${DASHBOARD_PORT}" \
    ghcr.io/get-convex/convex-dashboard:latest >/dev/null
fi

# --- 3. wait for convex API to answer --------------------------------------
log "waiting for convex API at $CONVEX_URL ..."
for _ in $(seq 1 30); do
  curl -fsS -m 3 "$CONVEX_URL/version" >/dev/null 2>&1 && break
  sleep 1
done

# --- 4. ingest key (sourced from convex env, never hard-coded) -------------
log "reading MAPR_INGEST_KEY from convex env"
INGEST_KEY="$(cd "$REPO_ROOT/convex" && bunx convex env get MAPR_INGEST_KEY 2>/dev/null | tail -1)"
[ -n "$INGEST_KEY" ] || { echo "ERROR: could not read MAPR_INGEST_KEY from convex env" >&2; exit 1; }

# --- 5. build ingestor if the release binary is missing --------------------
if [ ! -x "$INGESTOR_BIN" ]; then
  log "building rust ingestor (release)"
  (cd "$REPO_ROOT/ingestor" && cargo build --release)
fi

# --- 6. (re)start the continuous worker ------------------------------------
# Kill any prior worker so re-running is safe (no duplicate ingestion loops).
# Match the binary by suffix so workers started via relative OR absolute path
# are both caught.
WORKER_PAT='release/mapr-ingestor'
if pgrep -f "$WORKER_PAT" >/dev/null 2>&1; then
  log "stopping previous ingestor worker(s)"
  pkill -f "$WORKER_PAT" || true
  sleep 1
fi

log "starting ingestor worker (logs -> $INGESTOR_LOG)"
CONVEX_URL="$CONVEX_URL" \
MAPR_INGEST_KEY="$INGEST_KEY" \
OLLAMA_URL="$OLLAMA_URL" \
EMBED_MODEL="$EMBED_MODEL" \
INGEST_INTERVAL_SECS="$INGEST_INTERVAL_SECS" \
  nohup "$INGESTOR_BIN" >> "$INGESTOR_LOG" 2>&1 &
WORKER_PID=$!
sleep 1
log "ingestor worker PID=$WORKER_PID"

# --- 7. report -------------------------------------------------------------
cat <<EOF

  Access URLs
  -----------------------------------------------------------------
  Web frontend     http://127.0.0.1:5173   (run: cd web && bun run dev)
  Convex API       ${CONVEX_URL}
  Convex dashboard http://127.0.0.1:${DASHBOARD_PORT}
                   -> deployment URL: ${CONVEX_URL}
                   -> admin key: CONVEX_SELF_HOSTED_ADMIN_KEY in convex/.env.local
  Ollama           ${OLLAMA_URL}

  Ingestor worker  PID ${WORKER_PID}  |  log: ${INGESTOR_LOG}
  -----------------------------------------------------------------
EOF
