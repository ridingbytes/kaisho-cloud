# Kaisho Cloud

Cloud sync service for
[Kaisho](https://github.com/ridingbytes/kaisho). Mobile PWA
for time tracking that syncs back to the local app.

## Architecture

```
+-----------------+       +--------------------+
|  Mobile PWA     | <-->  |  Express API       |
|  (React/Vite)   |       |  kaisho-cloud      |
|  mobile/        |       |  api/              |
+-----------------+       +---+-----+------+---+
                              |     |      |
                         Supabase  Stripe Resend
                         (DB+Auth) (billing) (email)

                                |
                                v
                         +-----------------+
                         |  Local Kaisho   |
                         |  (pull clocks,  |
                         |   push snapshot)|
                         +-----------------+
```

Two parts:
- **`api/`** — Express server (auth, clocks, sync, billing)
- **`mobile/`** — React PWA served at `/m/` (users sign up,
  track time on their phone)

## Features

- Start/stop timers and book time from any device
- Customer and task reference data synced from local app
- Clock entries sync back to local kaisho on reconnect
- API key auth for local sync client, JWT for mobile
- Subscription management (Cloud Sync, +AI)

## Documentation

| Document                                     | Contents                       |
|----------------------------------------------|--------------------------------|
| [docs/saas-setup.md](docs/saas-setup.md)     | Supabase, Stripe, Resend setup |
| [docs/development.md](docs/development.md)   | Local development              |
| [docs/deployment.md](docs/deployment.md)     | VPS deployment with Docker     |

## Quick start

```bash
# 1. Install API deps
pnpm install

# 2. Build the mobile PWA (served from api/ at /m/)
cd mobile && pnpm install && pnpm build && cd ..

# 3. Configure secrets
cp .env.example .env   # fill in Supabase, Stripe, Resend

# 4. Run the API
pnpm dev
```

Then open:
- `http://localhost:3000/m/` — mobile PWA (sign up, track
  time)
- `http://localhost:3000/health` — API health check

See [docs/development.md](docs/development.md) for full
setup.
