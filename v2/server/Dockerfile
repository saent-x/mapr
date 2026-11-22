# MAPR v2 ingestor. Build from the v2 directory (compose does this):
#   docker build -f server/Dockerfile -t mapr-ingestor .
# The context is v2/ so the image can carry db/migrations and sources/sources.json.

FROM node:22-slim AS base
RUN npm install -g pnpm@10.28.0 && npm cache clean --force
WORKDIR /app
COPY server/package.json server/pnpm-lock.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/src ./src
RUN pnpm build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod

FROM node:22-slim
ENV NODE_ENV=production \
    HTTP_HOST=0.0.0.0 \
    HTTP_PORT=8787 \
    MIGRATIONS_DIR=/app/migrations \
    SOURCES_FILE=/app/sources/sources.json
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server/package.json ./
COPY db/migrations ./migrations
COPY sources/sources.json ./sources/sources.json
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
