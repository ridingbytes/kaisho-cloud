# Hosted kaisho-cloud stack

Self-contained deployment of the open-source kaisho-cloud as
our managed "sync + AI" server: the app image plus its own
PostgreSQL, no Supabase. It mirrors the owncloud stack on the
same VPS (app + dedicated `postgres:16` on a private internal
network, joined to the shared external `traefik-public`
network for ingress).

This stack runs in **parallel** to the current Supabase-based
`kaisho-cloud` stack and becomes the canonical
`cloud.kaisho.dev` at cutover.

## Status / dependency

The `db` and `migrate` services work today. The `api` and
`cron` services boot on Postgres only once the pg data layer
and self-owned auth have landed (they still require Supabase
env until then). Bring `db` up early if you like; bring
`api` + `cron` up at cutover.

## Layout

```
deploy/hosted/
  docker-compose.yml        db + migrate + api + cron
  .env.example              copy to .env, fill secrets
  traefik/kaisho-cloud.yml  file-provider route (cutover only)
```

## First deploy (target: /home/docker/kaisho-sync on the VPS)

```bash
# 1. Files
mkdir -p /home/docker/kaisho-sync
# copy deploy/hosted/* into it (compose, .env.example, traefik/)

# 2. Secrets
cp .env.example .env && chmod 600 .env
# set POSTGRES_PASSWORD + a matching DATABASE_URL, INTEGRATION_KEY
# (openssl rand -hex 32), INTEGRATION_STATE_SECRET, RESET_TOKEN_SECRET,
# OPENROUTER_API_KEY, BASE_URL.

# 3. Database first (safe now)
docker compose up -d db
docker compose run --rm migrate     # applies db/schema.sql

# 4. App (cutover, once the image boots on Postgres)
docker compose up -d api cron
```

## Cutover to cloud.kaisho.dev

`traefik/kaisho-cloud.yml` claims `cloud.kaisho.dev`, which the
old stack currently serves. To cut over atomically:

```bash
# remove the old route, add the new one, in one step
rm /home/docker/traefik/conf.d/kaisho-cloud.yml         # old stack
cp traefik/kaisho-cloud.yml /home/docker/traefik/conf.d/ # this stack
# Traefik hot-reloads; then stop the old stack
cd /home/docker/kaisho-cloud && docker compose down
```

To smoke-test in parallel **before** cutover, edit the rule in
`traefik/kaisho-cloud.yml` to `Host(\`cloud-next.kaisho.dev\`)`,
point that DNS record at the VPS, and copy it into `conf.d/`
alongside the existing route.

## Operating

```bash
docker compose ps
docker compose logs -f api
docker compose run --rm migrate      # re-run after schema changes
docker compose exec db psql -U kaisho kaisho
```

Backups: the Postgres data lives in the `kaisho-sync-pg-data`
named volume. Add it to the VPS backup routine (pg_dump) the
same way the other stacks are handled.
