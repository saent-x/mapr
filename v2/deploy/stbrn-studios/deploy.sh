#!/usr/bin/env bash
# Start (or update) MAPR v2 on stbrn-studios. Run on the server from this folder:
#   bash deploy.sh
# Idempotent. Prints no secrets. Everything lives under /data/mapr.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || cp .env.example .env
for k in EMBED_THREADS EMBED_MODEL_ID; do
  grep -q "^$k=" .env || grep "^$k=" .env.example >> .env
done

# API token for the Worker -> ingestor API. Created once, readable only by uid 50999.
if ! sudo test -f /data/mapr/secrets/api_token; then
  sudo sh -c 'umask 077; openssl rand -hex 32 | tr -d "\n" > /data/mapr/secrets/api_token'
fi
sudo chown 50999:50999 /data/mapr/secrets/api_token /data/mapr/secrets/pg_password
sudo chmod 400 /data/mapr/secrets/api_token /data/mapr/secrets/pg_password
sudo mkdir -p /data/mapr/models && sudo chown 10001:10001 /data/mapr/models

df -h / /data | sed 's/^/before: /'
docker compose build ingestor embedder
docker compose up -d db
docker compose run --rm ingestor node dist/seed.js
docker compose up -d
docker compose ps
df -h / /data | sed 's/^/after: /'
echo DONE
