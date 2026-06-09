# MAPR — restore drill (embedded-SQLite Convex)

`backup.sh` produces two artifacts per run (under `<remote>/<timestamp>/`):

| Artifact | What it is | Use it for |
| --- | --- | --- |
| `convex-snapshot.zip` | `convex export` logical snapshot | Migrating to a fresh deployment or to **managed Convex Cloud** (the lift path) — portable, deployment-independent |
| `convex_data.tgz` | tar of the `convex_data` volume (SQLite backing store + files) | Fast same-box / disaster recovery — exact bytes |

Restore the **volume snapshot** for same-box recovery (fastest, exact). Use the
**logical export** when moving to a *new* deployment (new instance secret, new
host, or Convex Cloud).

## A. Fetch a backup
```sh
rclone copy s3:mapr-backups/<timestamp> ./restore --progress
```

## B. Restore the SQLite volume (disaster recovery, same box)
1. Stop the stack so nothing holds the volume open:
   ```sh
   docker compose -f deploy/docker-compose.yml down
   ```
2. Reset + repopulate the `convex_data` volume from the snapshot:
   ```sh
   docker volume rm mapr_convex_data || true
   docker volume create mapr_convex_data
   docker run --rm -v mapr_convex_data:/data -v "$PWD/restore":/in alpine:3 \
     sh -c "cd /data && tar xzf /in/convex_data.tgz"
   ```
3. Bring the stack back up (keep the SAME `INSTANCE_SECRET` in `.env` so the
   admin key still matches):
   ```sh
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
   docker compose -f deploy/docker-compose.yml logs -f convex-backend   # expect a clean start
   ```
4. Verify: open the dashboard, or `curl -s -XPOST $CONVEX_URL/api/query -d '{"path":"events:list","args":{},"format":"json"}'` and confirm row counts.

## C. Restore via the logical export (new deployment / Convex Cloud — the lift path)
Use this when the volume snapshot is unusable, or when moving to a fresh backend
(new box or **Convex Cloud**). The app code in `/convex` is identical either way.

1. Stand up the target deployment + generate its admin key (README steps 1–3),
   then `convex deploy` the functions from `/convex`.
2. Import the snapshot:
   ```sh
   cd convex && npx convex import --replace ./restore/convex-snapshot.zip
   ```
3. Re-set function env (`convex env set …`, or re-run the `bootstrap` service)
   and reseed sources if needed (`ingest:seedSources`).
4. Point the `web` build + Stripe webhook at the new origin.

> Note: the corpus is pruned to ~30 days and re-populates from live feeds within
> minutes of the ingestor reconnecting — so even a total loss is self-healing for
> recent data. The backups exist mainly for users, billing links, watchlists,
> alerts, saved views, and QA history.
