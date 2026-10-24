# mapr web (v2)

Cloudflare Worker for the MAPR watch desk.

- Cron, every minute: pages `GET $INGEST_URL/v1/events` from the stored cursor, merges into a 24h window (drops `relevant === false`), writes one KV value (`snapshot:v1`: events + cursor) only when the ingestor returned something, and pushes changes to the `LiveHub` Durable Object.
- `GET /api/events`: the window, severity desc then `updated_at` desc. Cached 15s.
- `GET /live`: WebSocket (hibernating). Messages: `{ type: "events", upsert: Event[], remove: id[] }`. Send `ping`, get `pong`.
- `GET /healthz`: `{ ok, snapshot_age_s, events, cursor }`. Snapshot age grows while nothing changes upstream.
- Everything else: the desk page from `dist/public`, built by `scripts/build-client.mjs`. MapLibre GL (flat and globe) and the fonts are bundled. The only third-party requests are vector tiles and glyphs from OpenFreeMap (`tiles.openfreemap.org`, free, no key), styled by `src/client/style.json`. `src/client/_headers` sets the CSP.

## Develop

```sh
pnpm install
pnpm typecheck
pnpm test        # builds the page, then vitest inside workerd (@cloudflare/vitest-plugin)

echo 'INGEST_TOKEN=...' > .dev.vars
pnpm wrangler dev --test-scheduled --var INGEST_URL:https://<ingest-host>
curl 'http://localhost:8787/__scheduled?cron=*+*+*+*+*'   # run one cron tick
```

## Deploy (once)

```sh
pnpm wrangler kv namespace create SNAPSHOT   # paste the id into wrangler.jsonc
# set vars.INGEST_URL in wrangler.jsonc to the tunnel hostname
pnpm wrangler secret put INGEST_TOKEN        # the ingestor's API_TOKEN
pnpm wrangler deploy
```

Custom domain: uncomment `routes` in `wrangler.jsonc`, then deploy.

## Cost

Workers, KV and one Durable Object only. At most one KV write per minute, none while upstream is quiet. Sockets hibernate, so an idle hub bills no duration.
