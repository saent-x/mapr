# web/Dockerfile
# MAPR web client — Vite/React SPA built with Bun, served by nginx.
# The Convex origins are inlined at BUILD time (Vite reads import.meta.env), so
# they arrive as build args from docker-compose (= CONVEX_CLOUD/SITE_ORIGIN).

# --- Builder ---------------------------------------------------------------
FROM oven/bun:1 AS builder
WORKDIR /app

# Public Convex origins (tunnel hostnames). Exported as env BEFORE the build so
# Vite can inline them; VITE_CONVEX_URL is required by src/main.jsx.
ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
# Optional: override the MapLibre basemap style URL (defaults to Carto dark-matter
# in code). Point at a self-hosted style for a fully self-contained deploy.
ARG VITE_MAP_STYLE
ENV VITE_CONVEX_URL=${VITE_CONVEX_URL}
ENV VITE_CONVEX_SITE_URL=${VITE_CONVEX_SITE_URL}
ENV VITE_MAP_STYLE=${VITE_MAP_STYLE}

# Install deps first for layer caching.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile || bun install

# Build the static bundle into /app/dist (includes public/world.geo.json).
COPY . .
RUN bun run build

# --- Runtime ---------------------------------------------------------------
FROM nginx:alpine AS runtime
# Static bundle (includes /world.geo.json from public/). The SPA server config
# (try_files fallback, gzip, cache + security headers) lives in deploy/nginx.conf
# and is mounted over the default config at runtime by docker-compose.
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
