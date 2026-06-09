#!/usr/bin/env bash
# Off-box backup of the MAPR self-hosted state (embedded-SQLite Convex):
#   1. `convex export` — a logical, portable Convex snapshot (admin key).
#   2. A raw copy of the `convex_data` volume (SQLite backing store + files),
#      for fast same-box / disaster recovery.
# Both are pushed to an OFF-BOX destination with rclone (S3/R2/B2/etc.).
#
# Run on the box (cron snippet at the bottom). Requires: docker compose, rclone,
# and Node/npx (for `convex export`). Reads deploy/.env for the admin key.
#
# Usage:  RCLONE_REMOTE=s3:mapr-backups ./backup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
ENV_FILE="$DEPLOY_DIR/.env"
RCLONE_REMOTE="${RCLONE_REMOTE:?set RCLONE_REMOTE, e.g. s3:mapr-backups}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Load the admin key + URL from deploy/.env.
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
export CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL:-http://127.0.0.1:3210}"
export CONVEX_SELF_HOSTED_ADMIN_KEY="${CONVEX_SELF_HOSTED_ADMIN_KEY:?set CONVEX_SELF_HOSTED_ADMIN_KEY in deploy/.env}"

# --- 1. Convex logical export (portable; admin-key snapshot) ----------------
echo "[backup] convex export ..."
( cd "$REPO_ROOT/convex" && npx convex export --path "$STAGE/convex-snapshot.zip" )

# --- 2. Raw SQLite backing-store snapshot (fast same-box restore) -----------
# Quiesce the backend before the tar so the SQLite files (and any -wal/-shm) are
# in a consistent, crash-safe state on disk — a hot tar of a live embedded SQLite
# DB can capture a torn write and restore to a corrupt store. We stop ONLY the
# backend (the sole writer of convex_data), tar, then restart it. A trap ensures
# the backend is restarted even if the tar fails. The logical export above is the
# authoritative restore for cross-deployment moves.
echo "[backup] stopping convex-backend for a consistent volume snapshot ..."
docker compose -f "$COMPOSE_FILE" stop convex-backend
restart_backend() { docker compose -f "$COMPOSE_FILE" start convex-backend || true; }
trap 'restart_backend; rm -rf "$STAGE"' EXIT

echo "[backup] snapshotting convex_data volume ..."
docker run --rm \
  -v mapr_convex_data:/data:ro \
  -v "$STAGE":/out \
  alpine:3 sh -c "cd /data && tar czf /out/convex_data.tgz ."

echo "[backup] restarting convex-backend ..."
restart_backend
trap 'rm -rf "$STAGE"' EXIT   # backend is up again; revert to plain cleanup

# --- 3. Push off-box --------------------------------------------------------
echo "[backup] uploading to $RCLONE_REMOTE/$STAMP ..."
rclone copy "$STAGE" "$RCLONE_REMOTE/$STAMP" --progress
echo "[backup] done: $RCLONE_REMOTE/$STAMP"

# --- cron (daily 04:30 UTC) -------------------------------------------------
# 30 4 * * *  RCLONE_REMOTE=s3:mapr-backups /opt/mapr/deploy/backup/backup.sh >> /var/log/mapr-backup.log 2>&1
