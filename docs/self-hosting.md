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

Leave `SIGNUP_MODE=open`. Optionally set `OPENROUTER_API_KEY`
for AI.

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

## Managing users

Set `ADMIN_API_KEY` in `.env` (a long random value) to enable admin
management. This is also how you lock a public server down: set
`SIGNUP_MODE=token` so `/auth/signup` is closed and accounts exist only
when you create them.

### Admin console

The easiest way is the built-in web console at
`https://kaisho.example.com/console`. Enter your `ADMIN_API_KEY` and you
can add users, reset passwords, disable/enable or delete accounts,
rotate sync tokens, and see each account's sync status (clock entries,
tasks, notes, last activity).

### Admin API

The console uses this API; you can also call it directly with
`Authorization: Bearer <ADMIN_API_KEY>`.

```bash
BASE=https://kaisho.example.com
ADMIN="Authorization: Bearer $ADMIN_API_KEY"

# List accounts
curl -s -H "$ADMIN" $BASE/admin/accounts

# Create an account (returns a sync token for the desktop app)
curl -s -H "$ADMIN" -H "Content-Type: application/json" \
  -d '{"email":"me@example.com","password":"a-good-password"}' \
  $BASE/admin/accounts

# Change / reset a password
curl -s -H "$ADMIN" -H "Content-Type: application/json" \
  -d '{"password":"a-new-password"}' \
  $BASE/admin/accounts/<user_id>/password

# Disable / re-enable an account (revokes sync immediately)
curl -s -X POST -H "$ADMIN" $BASE/admin/accounts/<user_id>/disable
curl -s -X POST -H "$ADMIN" $BASE/admin/accounts/<user_id>/enable

# Rotate an account's sync token (invalidates the old one)
curl -s -X POST -H "$ADMIN" \
  $BASE/admin/accounts/<user_id>/rotate-token

# Delete an account and all of its data
curl -s -X DELETE -H "$ADMIN" $BASE/admin/accounts/<user_id>
```

Get `<user_id>` from the list endpoint. Users can also reset their own
password from the app if you configure email (`RESET_TOKEN_SECRET` +
`RESEND_API_KEY`); without email, use the admin password endpoint above.

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

## There is no managed option

We do not host Kaisho for anyone. Self-hosting is the way to use
cloud sync, which is why this page exists and why the server is
under the AGPL. If you are reading an older page that offers a
Kaisho-hosted instance, it is out of date.
