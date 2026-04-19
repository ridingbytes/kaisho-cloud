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

The mobile app lives in `mobile/` and is a Vite + React 19 +
TypeScript PWA. In production it is served by the Express
API at `/m/` from `mobile/dist/`. For local dev you have
two options:

**Option A -- use the built mobile app through the API:**

```bash
cd mobile && pnpm install && pnpm build && cd ..
pnpm dev
# Open http://localhost:3000/m/
```

Rebuild after any frontend change.

**Option B -- run Vite dev server with hot reload:**

```bash
# Terminal 1: API (port 3000 by default)
pnpm dev

# Terminal 2: Vite dev server
cd mobile && pnpm dev
# Open http://localhost:5173/m/
```

Vite proxies `/auth`, `/clocks`, `/sync`, `/ref`,
`/billing`, `/ai`, and `/health` to `http://localhost:3030`
(see `mobile/vite.config.ts`). Set `PORT=3030` in your
`.env` or adjust the proxy target to match your API port.

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

### Pull changes (with API key)

```bash
curl "http://localhost:3000/sync/changes?since=2024-01-01" \
  -H "Authorization: Bearer <api_key>"
```

### Password reset flow

```bash
# Request reset email
curl -X POST http://localhost:3000/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# Reset with token (from email link)
curl -X POST http://localhost:3000/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token":"<token>","password":"newpass123"}'
```

### AI endpoints (requires sync_ai plan)

```bash
# Parse a natural-language booking
curl -X POST http://localhost:3000/ai/parse-booking \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"2h acme fix login"}'

# Check AI usage
curl http://localhost:3000/ai/usage \
  -H "Authorization: Bearer <access_token>"
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

The API is available at `http://localhost:3000`. The
Dockerfile uses a two-stage build: stage 1 builds the
mobile PWA with `pnpm`, stage 2 installs API dependencies
with `npm ci` and copies the built PWA into `mobile/dist`.

## Environment variables

See `.env.example` for the full list. Required variables:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_SYNC` | Stripe price ID for sync plan |
| `STRIPE_PRICE_SYNC_AI` | Stripe price ID for sync_ai plan |
| `RESEND_API_KEY` | Resend API key for emails |
| `OPENROUTER_API_KEY` | OpenRouter key (sync_ai only) |
