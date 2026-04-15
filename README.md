# Kaisho Cloud

Cloud sync API for [Kaisho](https://github.com/ridingbytes/kaisho).
Enables mobile clock tracking that syncs back to the local app.

## Architecture

- **Express.js** API server
- **Supabase** for database (PostgreSQL) and auth
- **Stripe** for subscription billing
- **Resend** for transactional emails

## Features

- Start/stop timers and book time from any device
- Customer and task reference data synced from local app
- Clock entries sync back to local kaisho on reconnect
- Subscription management (Cloud Sync $5/mo, +AI $15/mo)

## Documentation

| Document                               | Contents                          |
|----------------------------------------|-----------------------------------|
| [docs/saas-setup.md](docs/saas-setup.md)     | Supabase, Stripe, Resend setup    |
| [docs/development.md](docs/development.md)   | Local development                 |
| [docs/deployment.md](docs/deployment.md)     | VPS deployment with Docker        |

## Quick start

```bash
pnpm install
cp .env.example .env   # fill in credentials
pnpm dev
```

See [docs/development.md](docs/development.md) for details.
