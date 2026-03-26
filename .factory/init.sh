#!/bin/bash
set -e

cd "$(dirname "$0")/.."

# Install dependencies if node_modules is missing or stale
if [ ! -d node_modules ] || [ package.json -nt node_modules/.package-lock.json ]; then
  echo "[init] Installing dependencies..."
  npm install
else
  echo "[init] Dependencies up to date."
fi

# Verify .env exists
if [ ! -f .env ]; then
  echo "[init] WARNING: .env file not found. Backend requires DATABASE_URL."
fi

echo "[init] Environment ready."
