# Local Development

## Prerequisites

- Node.js 22+
- A Supabase project (see `saas-setup.md`)
- Stripe test-mode keys (see `saas-setup.md`)

## Setup

1. Clone the repository:

   ```bash
   git clone git@github.com:ridingbytes/kaisho-cloud.git
   cd kaisho-cloud
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Create `.env` from `.env.example` and fill in credentials.
   For local development, use Stripe test-mode keys and the
   Supabase project URL.

4. Run the database migration in the Supabase SQL editor
   (see `saas-setup.md`, section 1).

## Running

### API server

```bash
pnpm dev
```

Starts on `http://localhost:3000`. The server auto-loads
`.env` via Node's `--env-file` flag.

### Mobile PWA

The mobile app lives in `mobile/` and is a Vite + React + TS
PWA. In production it's served by the Express API at `/m/`
from `mobile/dist/`. For local dev you have two options:

**Option A — use the built mobile app through the API:**

```bash
cd mobile && pnpm install && pnpm build && cd ..
pnpm dev
# Open http://localhost:3000/m/
```

Rebuild after any frontend change.

**Option B — run Vite dev server with hot reload:**

```bash
# Terminal 1: API
pnpm dev

# Terminal 2: Vite dev server
cd mobile && pnpm dev
# Open http://localhost:5173/m/
```

Vite proxies `/auth`, `/clocks`, `/sync`, `/ref`, `/billing`
to `http://localhost:3000` (see `mobile/vite.config.ts`).

## Testing the API

### Signup

```bash
curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}'
```

Returns `{user_id, api_key}`. Save the API key.

### Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}'
```

Returns `{access_token, refresh_token, plan, ...}`.

### Start a clock (with JWT)

```bash
curl -X POST http://localhost:3000/clocks/start \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"description":"Working on feature"}'
```

### Push snapshot (with API key)

```bash
curl -X POST http://localhost:3000/sync/push-snapshot \
  -H "Authorization: Bearer <api_key>" \
  -H "Content-Type: application/json" \
  -d '{"customers":[{"name":"Acme","contracts":[]}],"tasks":[]}'
```

### Pull unsynced clocks (with API key)

```bash
curl http://localhost:3000/sync/pull-clocks \
  -H "Authorization: Bearer <api_key>"
```

## Stripe webhook testing

Use the Stripe CLI to forward webhook events locally:

```bash
stripe listen --forward-to localhost:3000/billing/webhook/stripe
```

Copy the signing secret and set `STRIPE_WEBHOOK_SECRET` in `.env`.

In another terminal, trigger test events:

```bash
stripe trigger checkout.session.completed
```

## Docker

Build and run with Docker:

```bash
docker compose up --build
```

The API is available at `http://localhost:3000`.
