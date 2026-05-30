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
bin/dev
```

Starts on `http://localhost:3030`. `bin/dev` is the
recommended dev entrypoint -- it sets `PORT=3030` (which
matches the Vite proxy target), runs a port preflight to
clean up stale processes, and rebuilds the mobile bundle
on first run. Raw `pnpm dev` works too but reads `PORT`
from `.env` (default `3000`).

### Mobile PWA

The mobile app lives in `mobile/` and is a Vite + React 19 +
TypeScript PWA. In production it is served by the Express
API at `/m/` from `mobile/dist/`. For local dev you have
two options:

**Option A -- use the built mobile app through the API:**

```bash
cd mobile && pnpm install && pnpm build && cd ..
bin/dev
# Open http://localhost:3030/m/
```

Rebuild after any frontend change.

**Option B -- run Vite dev server with hot reload:**

```bash
# Terminal 1: API on :3030 (also rebuilds the mobile bundle)
bin/dev

# Terminal 2: Vite dev server on :5174
cd mobile && pnpm dev
# Open http://localhost:5174/m/
```

Vite proxies `/auth`, `/clocks`, `/sync`, `/ref`,
`/billing`, `/ai`, and `/health` to `http://localhost:3030`
(see `mobile/vite.config.ts`).

## Testing the API

### Signup

```bash
curl -X POST http://localhost:3030/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}'
```

Returns `{user_id, api_key}`. Save the API key.

### Login

```bash
curl -X POST http://localhost:3030/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}'
```

Returns `{access_token, refresh_token, plan, ...}`.

### Start a clock (with JWT)

```bash
curl -X POST http://localhost:3030/clocks/start \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"description":"Working on feature"}'
```

### Push snapshot (with API key)

```bash
curl -X POST http://localhost:3030/sync/push-snapshot \
  -H "Authorization: Bearer <api_key>" \
  -H "Content-Type: application/json" \
  -d '{"customers":[{"name":"Acme","contracts":[]}],"tasks":[]}'
```

### Pull changes (with API key)

```bash
curl "http://localhost:3030/sync/changes?since=2024-01-01" \
  -H "Authorization: Bearer <api_key>"
```

### Password reset flow

```bash
# Request reset email
curl -X POST http://localhost:3030/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# Reset with token (from email link)
curl -X POST http://localhost:3030/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token":"<token>","password":"newpass123"}'
```

### AI endpoints (requires a paid plan)

```bash
# Parse a natural-language booking
curl -X POST http://localhost:3030/ai/parse-booking \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"2h acme fix login"}'

# Check AI usage
curl http://localhost:3030/ai/usage \
  -H "Authorization: Bearer <access_token>"
```

## Stripe webhook testing

The webhook handler verifies every event against
`STRIPE_WEBHOOK_SECRET` (`api/server.js`). The Stripe CLI's
`stripe listen` mints its own signing secret for the forwarding
session, different from the dashboard one, so the secret in
`.env` must match what the CLI prints or every event fails
verification with a 400.

### One-time setup

In a dedicated terminal, start the forwarder and copy the
secret it prints:

```bash
stripe listen --forward-to localhost:3030/billing/webhook/stripe
# -> webhook signing secret is whsec_xxx
```

Set `STRIPE_WEBHOOK_SECRET=whsec_xxx` in `.env` and restart the
API. The CLI reuses the same secret across restarts, so this is
a one-time step per machine.

### Track A: synthetic events (no browser, no card)

The handlers key off `session.metadata.user_id` and `plan`
(`api/routes/stripe-webhook.js`). A bare `stripe trigger` ships
fixture events without that metadata, so the plan never
updates. Inject it with `--add`:

```bash
stripe trigger checkout.session.completed \
  --add checkout_session:metadata.user_id=<your-user-uuid> \
  --add checkout_session:metadata.plan=companion
```

`onCheckoutCompleted` writes `session.customer` and
`session.subscription` straight to the user row without
re-fetching, so this actually flips `users.plan` to `companion`
in Supabase and clears the plan cache. Swap `companion` for
`pro` to test upgrades. For token packs:

```bash
stripe trigger payment_intent.succeeded \
  --add payment_intent:metadata.user_id=<uuid> \
  --add payment_intent:metadata.price_id=$STRIPE_PRICE_TOKEN_PACK_500K
```

Idempotency: re-running the same trigger lands on the
`stripe_events` primary key and the second delivery returns
`{ received: true, duplicate: true }`.

### Track B: real Checkout with a test card

Mint a JWT for your account from `~/.config/ridingbytes/kaisho.env`:

```bash
JWT=$(scripts/dev-login.sh)
```

Create a checkout session and open the hosted page:

```bash
curl -sS -X POST http://localhost:3030/billing/checkout \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"plan":"companion","yearly":false}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["url"])' \
  | xargs open
```

Pay with `4242 4242 4242 4242`, any future expiry, any CVC.
Other useful cards: `4000 0000 0000 9995` (declined),
`4000 0025 0000 3155` (3-D Secure prompt). Stripe fires
`checkout.session.completed` -> the CLI forwards it -> the
webhook updates the plan.

### Two likely blockers for Track B

- **`automatic_tax: { enabled: true }`** in
  `api/routes/billing.js`: if Stripe Tax is not activated with
  an origin address in the test account, the checkout session
  fails to create. Activate Tax in the test dashboard, or flip
  it off locally to isolate.
- **`success_url` / `cancel_url`** use `BASE_URL`, default
  `https://cloud.kaisho.dev`. For local testing set
  `BASE_URL=http://localhost:3030` (or your PWA origin) so the
  post-payment redirect lands somewhere real.

### Sanity check

`node scripts/audit-stripe.js` confirms the price IDs in `.env`
resolve to the right products and the active webhook endpoint
points where you expect.

## Docker

Build and run with Docker:

```bash
docker compose up --build
```

The API is available at `http://localhost:3000`. The
Dockerfile uses a two-stage build: stage 1 builds the
mobile PWA with `pnpm`, stage 2 installs API dependencies
with `pnpm install --frozen-lockfile --prod` and copies
the built PWA into `mobile/dist`.

## Environment variables

See `.env.example` for the full list. Required variables:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_COMPANION_MONTHLY` / `_YEARLY` | Companion price IDs |
| `STRIPE_PRICE_PRO_MONTHLY` / `_YEARLY` | Pro price IDs |
| `STRIPE_PRICE_TEAM_MONTHLY` / `_YEARLY` | Team price IDs |
| `STRIPE_PRICE_TOKEN_PACK_500K` | Token-pack price ID |
| `RESEND_API_KEY` | Resend API key for emails |
| `OPENROUTER_API_KEY` | OpenRouter key (paid plans only) |

Optional:

| Variable | Purpose |
|---|---|
| `MCP_GATEWAY_ENABLED` | Mount the hosted MCP gateway at `POST /mcp` (Companion+) |
| `INTEGRATION_KEY` | 32-byte hex AES key for Pro integration credentials (`openssl rand -hex 32`) |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Slack OAuth app (Pro Slack integration) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth app (Pro Calendar integration) |
| `AI_MAX_CONCURRENCY` | Upstream AI concurrency limit (default 8) |
