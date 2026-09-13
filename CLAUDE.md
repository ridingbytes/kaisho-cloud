# Kaisho Cloud

Cloud sync + AI gateway + Stripe billing for the Kaisho
desktop app, and the mobile PWA. Live at
`https://cloud.kaisho.dev`.

## Architecture

- **API**: Node.js / Express (CommonJS), `pino` logger,
  `express-rate-limit`, Zod for input validation.
- **Mobile PWA**: React 19 + Vite, served by the API at `/m/`.
- **DB + Auth**: Supabase. All server-side DB writes use the
  service-role key (`api/db.js` builds two clients — service
  and auth — to avoid the supabase-js shared-state pitfall).
- **Billing**: Stripe live mode. Live products + webhook
  endpoint `we_1Tbybo4CP1EJS4RIkUJ3Kvs3` provisioned 2026-05-28.
- **AI**: OpenRouter via the gateway (`api/routes/ai.js`),
  metered per user per month in `ai_usage` with a hard cap.
- **Email**: Resend, from `noreply@kaisho.dev`.
- **Premium integrations** (Pro tier): Google Calendar, Slack,
  Linear, GitHub Projects. OAuth state HMAC uses
  `INTEGRATION_STATE_SECRET`; credentials AES-256-GCM encrypted
  at rest with `INTEGRATION_KEY`.

## Project layout

```
api/                Express server
  routes/           Endpoints by domain (auth, sync, billing,
                    ai, mcp, integrations, stripe-webhook)
  ai/               advisor.js (server-side loop), engine.js
                    (model + metering), tool defs
  workers/          cron.js (hosted cron worker, separate
                    process, heartbeats to cron_health table)
  integrations/     Per-provider modules + AES crypto helpers
  middleware.js     requireAuth, requireApiKey, requirePlan,
                    rate limiters
  validation.js     Zod schemas for every authenticated route
  ws.js             WebSocket fan-out (first-message auth)
  db.js             Supabase clients (service + auth)
  config.js         PLAN_QUOTAS, PLAN_PRICES, rate-limit budgets
mobile/             React 19 PWA (Vite)
supabase/migrations/  Numbered SQL files (apply via dashboard
                      or supabase db push)
scripts/            create-stripe-products.js,
                    sync-stripe-webhook.js, audit-stripe.js,
                    dev-login.sh (mint JWT from local API)
docs/               development.md (Stripe testing, dev-login),
                    saas-setup.md, deployment.md
```

## Dev commands

```bash
pnpm install
cd mobile && pnpm install && pnpm build && cd ..

cp .env.example .env   # fill in real secrets
pnpm dev               # loads .env, runs on :3000

# Mint a Supabase JWT for local API calls
JWT=$(scripts/dev-login.sh)
curl -H "Authorization: Bearer $JWT" \
  http://localhost:3000/ai/usage

# Stripe webhooks locally (one terminal):
stripe listen --forward-to localhost:3000/billing/webhook/stripe
# Copy the printed whsec_ into .env STRIPE_WEBHOOK_SECRET,
# restart API. See docs/development.md for the full guide.

# Audit live Stripe setup:
STRIPE_SECRET_KEY=$(awk -F= \
  '/^PROD_STRIPE_SECRET_KEY=/{print substr($0,index($0,"=")+1)}' \
  ~/.config/ridingbytes/kaisho.env) \
  node scripts/audit-stripe.js
```

## Deploy

- **`bin/deploy`**, over SSH, from a workstation. No CI, no
  registry: it rsyncs the work tree to the VPS, builds the
  image there, runs the migrations and restarts. Read
  `docs/deployment.md` before touching it. There is no
  `production` branch in this flow and no GitHub Actions
  workflow; `bin/deploy --check` tells you whether the host
  still matches the repo.
- **VPS**: `srv1390042.hstgr.cloud` (SSH alias `vps`, user
  `root`, sudo nopasswd). The managed stack lives at
  `/home/docker/kaisho-cloud/` (api `kaisho-cloud`, worker
  `kaisho-cron`, db `kaisho-cloud-db`). `.env` is at the
  same path, mode 600, and is never shipped.
- **Legacy stack**: retired 2026-09-13. The Supabase + Stripe
  stack that used to serve `cloud.kaisho.dev` is archived at
  `/home/docker/kaisho-cloud.legacy/` and stopped. Its data
  was not migrated; accounts start fresh.
- **Migrations**: `db/migrate.js`, run on every deploy.
  Supabase-era migrations under `supabase/migrations/` applied
  only to the retired stack and are kept for reference.

## Conventions

- CommonJS (`require` / `module.exports`). No ESM.
- Double quotes. ≤80 cols. No blind `try/catch Exception`.
- Every authenticated route gets a Zod schema in
  `validation.js` and an `asyncHandler` wrapper.
- `pino` logger throughout; never log full request bodies,
  JWTs, API keys, or OAuth tokens.
- Rate limiters in `config.js`; key by `req.userId || req.ip`
  (never `"unknown"` — pre-auth requests should fail closed).
- Trust the proxy: `app.set("trust proxy", 1)` is set in
  `server.js`; do not remove (Traefik IP would fill all
  buckets without it).
- Stripe webhook: raw body before `express.json()`, signature
  verified via `stripe.webhooks.constructEvent`, idempotency
  via insert-first on `stripe_events`, rollback the row on
  handler throw.
- Tests: any new auth or webhook path needs coverage.

## Kaisho ecosystem

The four kaisho repos ship together as the Track AI product:

- `kaisho` — desktop app (Python/FastAPI sidecar + React/TS
  frontend + Tauri shell). Auto-updater. Released as v2.x
  GitHub releases on `v*` tag push.
- `kaisho-cloud` — cloud API (Express + PostgreSQL + Resend +
  OpenRouter) plus the mobile PWA. Deployed by `bin/deploy`
  over SSH, which builds the image on the VPS.
- `kaisho-website` — marketing site (kaisho.dev). Deployed by
  its own `bin/deploy` over SSH; nothing publishes
  automatically.
- `kaisho-mode` — Emacs Lisp client. Loaded directly from local
  checkout by Doom config via `:local-repo`. No package registry.

Cross-cutting facts:

- Versioning: desktop + cloud move together (v2.0.0, v2.0.1,
  ...). Website + mode follow independent timelines.
- Wire contract between desktop and cloud:
  `kaisho-cloud/api/routes/sync.js` ↔
  `kaisho/kaisho/backends/sql/__init__.py`.
- Plan names align across all repos: `free | companion | pro |
  team`. Inactive-customer statuses align via the shared
  `INACTIVE_STATUSES` constant in `kaisho/services/customers.py`.
- Public marketing surface today: Local + Companion + Pro.
  Team exists in code but is a mailto on the pricing page.

## GitHub issue policy

Default to opening a GitHub issue whenever work is **not**
being shipped in the current session's PR.

**Open an issue when:**

- Deferred work — found but not fixed this session.
- Naked TODO in code — never leave a bare `TODO:`. Use
  `TODO(#123):` and link the issue from the body too.
- External dependency — gated on the user, a third party, or a
  future condition ("when we hit 1k users", "next Stripe rev").
- Discovered during code review / audit / live-test that we
  choose not to fix immediately.

**Don't open issues for** items being fixed in the same session
in a PR about to land — the PR body is the record.

**Conventions:**

- Labels: `Bug 🐞` (regression), `Enhancement ✨` (additive),
  `Refactor ♻️` (internal cleanup). Use the existing emoji form.
- Assignee: `ramonski`.
- Body sections: **Context** (what + where in code), **Why
  deferred** / **Why this matters**, **Acceptance** (close
  criteria), **Out of scope** when relevant.
- When a PR closes an issue, put `Closes #N` in the PR body.

## PR workflow

- **One PR per feature or isolated fix.** Don't bundle unrelated
  work — keeps history bisectable, eases review, and makes the
  CHANGELOG mechanically derivable.
- **CHANGELOG entry matches the PR title verbatim** and includes
  the PR number in brackets: `- Add token-pack webhook handler
  [#42]`. The PR body explains the *why*; the CHANGELOG line is
  the *what*.
- Ask before pushing branches or opening / editing PRs on the
  remote — direct commits to master are reserved for trivially
  reversible changes (typo fixes, `.gitignore` additions) and
  even those default to a PR if uncertain.
- No "Generated with Claude Code" / "Co-Authored-By" footer in
  commits, PR bodies, issue bodies, or release notes.

## Session continuity

At the start of any session in a kaisho repo, run these three
commands to orient without prior chat history:

```bash
git log --oneline -10        # recent commits
gh issue list --state open   # in-flight work
sed -n '1,30p' CHANGELOG.md  # latest release (if applicable)
```

The issue tracker is the durable record of in-flight work;
`CHANGELOG.md` is the durable record of what shipped.
