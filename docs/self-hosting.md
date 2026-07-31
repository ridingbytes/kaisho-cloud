# Self-hosting your Kaisho sync server

Kaisho is free and open source, and so is the sync server. Run your own
to keep your data under your control and track time from your phone,
your desktop, and your terminal, all syncing through a server you own.

There are no plans or tiers. Once your server is up, cloud sync, the
mobile PWA, the hosted AI gateway, and the integrations are all
available.

## What you get

- A **mobile web app (PWA)** at `https://your-server/m` for tracking
  time, triaging your inbox, and talking to the advisor from your phone.
- **Cross-device sync**: the desktop app, the phone PWA, and the CLI all
  share one account.
- Optional **hosted AI** (bring an OpenRouter key) and **scheduled AI
  runs** (the cron worker).

## Requirements

- Docker + Docker Compose.
- For phone use: a **domain and HTTPS**. Phones will not install a PWA
  or run its service worker over plain HTTP (localhost is the only
  exception). Put the server behind a reverse proxy that terminates TLS
  (Caddy, Traefik, nginx), or use the ready-made Traefik stack in
  `deploy/hosted/`.

## 1. Start the server

```bash
git clone https://github.com/ridingbytes/kaisho-cloud.git
cd kaisho-cloud
cp .env.example .env
```

Edit `.env` and set at least:

- `POSTGRES_PASSWORD` and a matching `DATABASE_URL`
  (`postgres://kaisho:<password>@db:5432/kaisho`),
- `JWT_SECRET` (e.g. `openssl rand -hex 32`).

Leave `DB_BACKEND=postgres` and `SIGNUP_MODE=open`. Optionally set
`OPENROUTER_API_KEY` for AI.

```bash
docker compose up --build -d
```

This starts Postgres, runs the schema migration, and serves the API +
PWA on port 3000. Check it:

```bash
curl http://localhost:3000/healthz    # if exposed; else check logs
docker compose logs -f api
```

## 2. Put it behind HTTPS (for phone use)

Point a domain (say `kaisho.example.com`) at your host and terminate TLS
with a reverse proxy that forwards to the `api` container on port 3000.
A minimal Caddy example:

```
kaisho.example.com {
    reverse_proxy localhost:3000
}
```

Or use the `deploy/hosted/` Traefik stack, which already wires up
Let's Encrypt (see `deploy/hosted/README.md`).

Set `BASE_URL=https://kaisho.example.com` in `.env` and restart so links
and CORS use the public URL.

## 3. Create your account

Open `https://kaisho.example.com/m` and sign up (email + password). On
signup you get a **sync token** (an API key). Keep it: it is what the
desktop and CLI use to connect.

You can also mint or rotate the token later from the app.

## 4. Track time on your phone

Open `https://kaisho.example.com/m` on your phone's browser and add it to
the home screen ("Add to Home Screen"). It installs as an app. Sign in,
start a timer, book time, check what's due. Everything syncs to your
server.

## 5. Connect the desktop app

In the Kaisho desktop app: **Settings > Cloud Sync**, enter your server
URL (`https://kaisho.example.com`) and your sync token, and press
**Connect**. The desktop and phone now share one account; clock entries,
tasks, notes, inbox, and projects sync both ways.

If your server has AI configured, the desktop offers the hosted
`kaisho:advisor` / `kaisho:cron` models automatically.

## Backups

Your data lives in the `kaisho-pg-data` Docker volume. Back it up with
`pg_dump`:

```bash
docker compose exec db pg_dump -U kaisho kaisho > kaisho-backup.sql
```

## Operating

```bash
docker compose ps
docker compose logs -f api
docker compose run --rm migrate     # re-run migrations after upgrade
docker compose exec db psql -U kaisho kaisho
```

## Optional: managed hosting

Prefer not to run a server? Point the desktop app at a Kaisho-hosted
instance instead. It runs this same open-source image; the only
difference is the URL. See the marketing site for details.
