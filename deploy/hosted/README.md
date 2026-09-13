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
  traefik/kaisho-cloud.yml cloud.kaisho.dev route
```

All three app services share one build and one image tag
(`kaisho-cloud:local`), so api, cron and migrate cannot drift
apart.

## First deploy

```bash
# On the VPS, once:
ssh vps
mkdir -p /home/docker/kaisho-cloud
chown -R docker:docker /home/docker/kaisho-cloud
# .env from .env.example, real secrets:
chmod 600 /home/docker/kaisho-cloud/.env

# From the repo:
bin/deploy
```

`bin/deploy` runs the tests, asks for confirmation, rsyncs
the work tree to `/home/docker/kaisho-cloud/src`, builds,
migrates, restarts and probes the health endpoint.

The route is not shipped by `bin/deploy`. Routes are
authoritative in the traefik repo's `conf.d/` and go out with
that repo's own `bin/deploy`; the copies here are the
app-side record.

## The retired Supabase stack

Until 2026-09-13 `cloud.kaisho.dev` was served by the
original Supabase + Stripe stack out of the same directory
this one now occupies. It is stopped and archived at
`/home/docker/kaisho-cloud.legacy/`, its containers removed
and its Traefik route gone. Its data was not migrated:
accounts on this stack start fresh.

Nothing depends on it any more, and the Supabase project
itself was deleted on 2026-09-13. Once the Stripe account is
closed out (open-source plan, phase 5), the archive directory
can go too — it holds only the old compose file and a `.env`
whose remaining secrets are due for rotation regardless.

## Operating

```bash
bin/health            # containers, db, endpoint, log scan
bin/logs cron         # or api / db
bin/backup            # dump on the VPS, fetch a copy here
bin/restore --list
ssh vps 'docker exec -it kaisho-cloud-db psql -U kaisho kaisho'
```

Backups run from the docker user's crontab on the VPS; see
`docs/deployment.md`.
