# Hosted kaisho-cloud stack

Our managed "sync + AI" server: kaisho-cloud plus its own
PostgreSQL, no Supabase. It mirrors the owncloud stack on the
same VPS (app plus a dedicated `postgres:16` on a private
internal network, joined to the shared external
`traefik-public` network for ingress).

This directory is the stack's definition. It is **not** run
from here: `bin/deploy` at the repo root ships it to the VPS
and builds it there. Read `docs/deployment.md` first.

The self-host stack for everyone else is `docker-compose.yml`
at the repo root, documented in `docs/self-hosting.md`.

## Layout

```
deploy/hosted/
  docker-compose.yml       db + migrate + api + cron
  backup                   pg_dump + rotation; runs on the VPS
  .env.example             copy to .env on the host, fill, 600
  traefik/kaisho-sync.yml  sync.kaisho.dev route (live today)
  traefik/kaisho-cloud.yml cloud.kaisho.dev route (cutover)
```

All three app services share one build and one image tag
(`kaisho-cloud:local`), so api, cron and migrate cannot drift
apart.

## First deploy

```bash
# On the VPS, once:
ssh vps
mkdir -p /home/docker/kaisho-sync
chown -R docker:docker /home/docker/kaisho-sync
# .env from .env.example, real secrets:
chmod 600 /home/docker/kaisho-sync/.env

# From the repo:
bin/deploy
```

`bin/deploy` runs the tests, asks for confirmation, rsyncs
the work tree to `/home/docker/kaisho-sync/src`, builds,
migrates, restarts and probes the health endpoint.

The route is not shipped by `bin/deploy`. Routes are
authoritative in the traefik repo's `conf.d/` and go out with
that repo's own `bin/deploy`; the copies here are the
app-side record.

## Cutover to cloud.kaisho.dev

The legacy Supabase stack in `/home/docker/kaisho-cloud`
still serves `cloud.kaisho.dev`. To take the host over, swap
the two routes in the traefik repo in one commit — delete
`conf.d/kaisho-cloud.yml`'s old body and replace it with
`traefik/kaisho-cloud.yml` from here, drop
`conf.d/kaisho-sync.yml` — deploy that repo, then stop the
legacy stack:

```bash
ssh vps 'cd /home/docker/kaisho-cloud && docker compose down'
```

Traefik hot-reloads `conf.d/`, so the swap has no window in
which the host is unrouted. Afterwards set `BASE_URL` and
`HEALTH_URL` to the new host.

## Operating

```bash
bin/health            # containers, db, endpoint, log scan
bin/logs cron         # or api / db
bin/backup            # dump on the VPS, fetch a copy here
bin/restore --list
ssh vps 'docker exec -it kaisho-sync-db psql -U kaisho kaisho'
```

Backups run from the docker user's crontab on the VPS; see
`docs/deployment.md`.
