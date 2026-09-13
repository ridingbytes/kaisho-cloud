# Deployment

Two audiences use this repo:

- **Self-hosters** run the stack at the repo root with
  `docker compose up --build`. See `self-hosting.md`; nothing
  on this page is required.
- **We** run one managed instance on the Hostinger VPS, from
  `deploy/hosted/`. That is what this page covers.

## How the managed deploy works

There is no CI and no registry in this path. The repo is the
source of truth and the VPS is a mirror:

```
work tree  --rsync-->  vps:/home/docker/kaisho-cloud/src
                            |
                            +-- docker compose build   (on the host)
                            +-- docker compose run migrate
                            +-- docker compose up -d db api cron
```

`bin/deploy` does all of it. Building on the host rather than
locally avoids emulating `linux/amd64` on an arm64 Mac and
keeps a deploy to one rsync plus a build.

`${REMOTE_DIR}/src` is a throwaway mirror. Nothing is edited
there by hand; `bin/deploy --check` reports it when someone
did anyway.

## Deploying

```bash
bin/deploy --check      # does the VPS still match the repo?
bin/deploy --dry-run    # what would ship
bin/deploy              # tests, confirm, ship, build, migrate,
                        # restart, health probe
```

The script refuses to finish silently: it runs `pnpm test`
first, asks for the literal word `deploy`, and probes
`HEALTH_URL` afterwards, dumping the API log and exiting
non-zero if the endpoint stays down for 60 seconds.

Overridable by environment: `REMOTE` (ssh alias, default
`vps`), `REMOTE_DIR` (default `/home/docker/kaisho-cloud`),
`HEALTH_URL` (default `https://cloud.kaisho.dev/healthz`),
`DEPLOY_CONFIRM=deploy` to skip the prompt.

### Rollback

There is no image tag to re-pin, so roll back the way you
rolled forward: check out the previous commit and deploy it
again. The VPS records what shipped in `.deploy-sha`, and the
one before it in `.deploy-sha.prev`.

```bash
ssh vps cat /home/docker/kaisho-cloud/.deploy-sha.prev
git checkout <that-sha>
bin/deploy
```

Roll back the database separately if a migration is at fault,
with `bin/restore` and the pre-deploy dump.

## The other scripts

| Script | Runs | Does |
|---|---|---|
| `bin/deploy` | locally | ships, builds, migrates, restarts |
| `bin/health` | locally | containers, Postgres, endpoint, log scan |
| `bin/logs` | locally | `bin/logs [api\|cron\|db] [flags]` |
| `bin/backup` | locally | triggers the host dump, fetches it |
| `bin/restore` | locally | restores a dump, stops api+cron first |
| `deploy/hosted/backup` | on the VPS | the dump itself; what cron runs |
| `bin/dev` | locally | local dev server, unrelated to deploys |

## Backups

The database is the only state the stack has, so a `pg_dump`
is a complete backup. `deploy/hosted/backup` is shipped to
`/home/docker/kaisho-cloud/backup` by every deploy and runs
from the docker user's crontab on the VPS, alongside the
other stacks:

```cron
30 5 * * * /home/docker/kaisho-cloud/backup \
    >> /home/docker/kaisho-cloud/backups/cron.log 2>&1
```

It keeps `BACKUP_KEEP` dumps (default 14), verifies each one
decompresses, and fails loudly on a suspiciously small dump
rather than leaving something that merely looks like a backup
in the listing.

## Traefik

Routing is a file-provider config, not Docker labels. The
authoritative copy of every route lives in the **traefik**
repo under `conf.d/`, and goes out with that repo's own
`bin/deploy`. `deploy/hosted/traefik/` holds the app-side
record of ours:

- `kaisho-cloud.yml` — `cloud.kaisho.dev`.

A route change is therefore two repos in one change:
`deploy/hosted/traefik/` here, `conf.d/` there.

## VPS layout

```
/home/docker/kaisho-cloud/
  docker-compose.yml     shipped by bin/deploy; do not edit here
  backup                 shipped by bin/deploy; run from cron
  .env                   ONLY on the host, mode 600, never shipped
  .deploy-sha[.prev]     what is running
  src/                   the rsynced work tree (build context)
  backups/               dumps + cron.log
```

Containers: `kaisho-cloud` (api), `kaisho-cron`,
`kaisho-cloud-db`. Networks: `traefik-public` (external,
ingress) and the stack's own `internal` (db access).

### One-time prep

```bash
ssh vps
mkdir -p /home/docker/kaisho-cloud
chown -R docker:docker /home/docker/kaisho-cloud
docker network inspect traefik-public >/dev/null 2>&1 \
  || docker network create traefik-public
# .env from deploy/hosted/.env.example, filled in:
chmod 600 /home/docker/kaisho-cloud/.env
```

The `.env` is never shipped and never committed. When a
variable is added to `.env.example`, add it on the host by
hand in the same change, before deploying code that needs it.

## Why not GitHub Actions

The workflow that used to live at `.github/workflows/deploy.yml`
built an image on a GitHub runner, pushed it to GHCR and ran
`docker compose pull` on the VPS over an SSH deploy key. It
was removed: it needed a deploy key and registry credentials
in CI, it hid the deploy behind a push to a `production`
branch, and it wrote to `/home/docker/kaisho-cloud` — the
legacy stack's directory — so deploying could silently
resurrect the stack we are retiring.

The desktop app (`kaisho`) is the one repo that keeps its
workflows: its release builds are multi-platform and cannot
be produced from one workstation.
