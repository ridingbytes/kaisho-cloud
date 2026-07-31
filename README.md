# Kaisho Cloud

The open-source sync + AI server for
[Kaisho](https://github.com/ridingbytes/kaisho). Run your own to track
time from your phone, desktop, and terminal, all syncing through a
server you control. Free, self-hostable on plain PostgreSQL, no plans or
tiers.

Prefer not to run a server? Point the apps at a Kaisho-hosted instance
instead. It runs this same image; the only difference is the URL.

## Architecture

```
+-----------------+       +--------------------+
|  Mobile PWA     | <-->  |  Express API       |
|  (React/Vite)   |       |  kaisho-cloud      | --> OpenRouter
|  served at /m   |       |  api/              |     (optional AI)
+-----------------+       +----------+---------+
                                     |
             +-----------------+     |     +-----------------+
             |  Desktop / CLI  | <---+---> |   PostgreSQL    |
             |  (sync token)   |           |  (your data)    |
             +-----------------+           +-----------------+
```

Two parts:
- **`api/`** — Node.js/Express server: auth (self-owned JWT + API keys),
  clocks, sync, AI gateway, WebSocket, cron worker.
- **`mobile/`** — React 19 PWA served at `/m` (sign up, track time on
  your phone).

Data lives in plain PostgreSQL; auth is self-owned (no Supabase). There
is no billing in this repo.

## Features

- Start/stop timers and book time from any device
- Cross-device sync (desktop, phone PWA, CLI) on one account
- API-key sync token for the desktop/CLI, JWT for the mobile PWA
- Password reset via HMAC-signed tokens (+ optional email)
- WebSocket push for real-time updates across devices
- Optional AI gateway proxying to OpenRouter, with a per-instance cap
- Optional scheduled AI runs (the cron worker)

## Quick start (self-host with Docker)

```bash
git clone https://github.com/ridingbytes/kaisho-cloud.git
cd kaisho-cloud
cp .env.example .env      # set POSTGRES_PASSWORD, DATABASE_URL, JWT_SECRET
docker compose up --build -d
```

This starts Postgres, runs the schema migration, and serves the API +
mobile PWA on port 3000. Open `http://localhost:3000/m` to sign up and
track time. For phone use you need HTTPS — see **self-hosting** below.

## Documentation

| Document | Contents |
|---|---|
| [docs/self-hosting.md](docs/self-hosting.md) | Run your own server + track time on your phone |
| [docs/architecture.md](docs/architecture.md) | System design, auth, sync, AI |
| [docs/development.md](docs/development.md)   | Local development |
| [deploy/hosted/](deploy/hosted/)             | Traefik + Postgres production stack |

## Develop

```bash
pnpm install
cd mobile && pnpm install && pnpm build && cd ..
cp .env.example .env
DB_BACKEND=postgres pnpm dev     # needs a reachable DATABASE_URL
npm test                          # unit tests
```
