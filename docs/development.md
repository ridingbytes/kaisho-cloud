# Local Development

## Prerequisites

- Node.js 22+
- A PostgreSQL you can point `DATABASE_URL` at. The quickest
  is the one in `docker-compose.yml`: `docker compose up -d db`.

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

3. Create `.env` from `.env.example` and fill it in. The two
   that have no default are `DATABASE_URL` and `JWT_SECRET`
   (`openssl rand -hex 32`).

4. Apply the schema:

   ```bash
   pnpm migrate:dev
   ```

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
| `RESEND_API_KEY` | Resend API key for emails |
| `OPENROUTER_API_KEY` | OpenRouter key for the AI gateway |

Optional:

| Variable | Purpose |
|---|---|
| `MCP_GATEWAY_ENABLED` | Mount the hosted MCP gateway at `POST /mcp` (Companion+) |
| `INTEGRATION_KEY` | 32-byte hex AES key for Pro integration credentials (`openssl rand -hex 32`) |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Slack OAuth app (Pro Slack integration) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth app (Pro Calendar integration) |
| `AI_MAX_CONCURRENCY` | Upstream AI concurrency limit (default 8) |
