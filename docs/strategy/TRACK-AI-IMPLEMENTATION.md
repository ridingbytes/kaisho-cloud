# KAISHO Track AI — Implementation Concept

Companion to `AI-COMPANION-PIVOT.md` (the why) and
`TRACK-AI-METRICS.md` (the kill switch). This doc covers
**how** Companion (€29), Pro (€59), and Team (€99/seat)
get built on top of the existing kaisho + kaisho-cloud
codebase.

Bottom line: ~80% of Companion is already shipped. Pro adds
integrations and quota. Team is the only tier that needs
real schema work.

---

## 1. What already exists

### kaisho (Python desktop OSS, `~/develop/kaisho`)

- **MCP server** — `kaisho/mcp/server.py` (251 LOC, FastMCP).
  Stdio entry point already exposes 40+ Kaisho tools
  (`add_task`, `book_time`, `list_customers`,
  `search_knowledge`, `start_clock`, `web_search`, …).
  Tier filtering (`read`/`write`/`destructive`) is in
  place. Profile-follow logic for multi-profile workflows
  already works.
- **Cron AI agents** — `kaisho/cron/` with APScheduler.
  Jobs defined in `jobs.yaml`, executor in `executor.py`,
  templates in `services/cron_templates.py`. Already
  supports BYO models (Claude / OpenRouter / Ollama / LM
  Studio / OpenAI) and the cloud gateway.
- **AI backends** — `kaisho/backends/` per data backend
  (org/markdown/sql/json). All cron + advisor calls go
  through the same `execute_tool()` dispatcher the MCP
  server uses, so behaviour is consistent.
- **Cloud sync client** — `kaisho/api/routers/cloud_sync.py`,
  `kaisho/services/cloud_ws.py`. Already plan-aware: gates
  features on `sync` vs `sync_ai`.

### kaisho-cloud (Node.js + Supabase, `~/develop/kaisho-cloud`)

- **AI gateway** — `api/routes/ai.js` (855 LOC). Proxies
  OpenAI-compatible requests to OpenRouter, meters per-user
  per-month in `ai_usage` (input/output/requests). Backend
  is swappable via `gateway_config` table without restart;
  per-user overrides are supported.
- **Sync** — `api/routes/sync.js` for clocks, inbox, tasks,
  notes. Last-writer-wins on `updated_at`, tombstones for
  deletes, cursor pagination. Used by mobile PWA and
  desktop.
- **Auth** — `api/db.js`. Bcrypt API keys + Supabase JWTs.
  5-min auth cache. `requireAuth` + `requirePlan(...)`
  middleware composes per-route.
- **Billing** — `api/routes/billing.js` +
  `api/routes/stripe-webhook.js`. Checkout, portal,
  subscription state, idempotent webhook handler. Plans
  currently `sync` (€9) and `sync_ai` (€19) — see migration
  task below.
- **WebSocket** — `api/ws.js`. Real-time push for cross-
  device updates (timer started/stopped, entry changed).
- **Mobile PWA** — `mobile/dist/` served at `/m/*` from the
  API server. Already gated on a Cloud Sync subscription.

### Gap summary

| Capability                          | Built? | Notes |
|-------------------------------------|--------|-------|
| MCP server (read/write tools)       | ✅     | Need install guides + registry submissions |
| Cron-AI scheduler                   | ✅     | Need 3 "wow" templates polished for launch |
| AI gateway with metering            | ✅     | Need cap bump + overage packs |
| Stripe checkout / portal / webhooks | ✅     | Need to retire `sync`/`sync_ai`, add new SKUs |
| Cloud sync (clocks/inbox/tasks/KB)  | ✅     | Done |
| Real-time WS                        | ✅     | Done |
| Mobile PWA                          | ✅     | Done |
| Premium MCP integrations            | ❌     | Pro tier — Linear / GH Projects / Calendar / Slack |
| Per-org seats + RBAC                | ❌     | Team tier — only real schema work needed |
| Shared KB / team cron               | ❌     | Team tier |
| Audit log                           | ❌     | Team tier |

---

## 2. Tier-by-tier scope

### 2.1 Hobby (€0) — no change

Today: full desktop, BYO API key, local-only. Stays that
way. Existing OSS users should not need to do anything.

### 2.2 Companion (€29 / €290/yr)

Differences vs Hobby:

1. Hosted token quota — **500k tokens / month** of a
   frontier model (currently `anthropic/claude-haiku-4.5`
   per `gateway_config`).
2. Cross-device sync + mobile PWA (already shipped on
   `sync`/`sync_ai`).
3. Scheduled cron-AI runs hosted server-side (today they
   run on the user's machine via APScheduler — Companion
   gets the option of running them in the cloud so they
   fire when the laptop is closed).
4. MCP gateway for Claude Code / Cursor (today the MCP
   server runs locally over stdio; Companion adds the
   hosted relay so the editor can reach Kaisho when the
   desktop is off).
5. Overage packs — €15 / 500k extra tokens.

The product surface already covers (1) and (2). (3) and
(4) are net-new server-side work. (5) is a Stripe
add-on + a small UI.

### 2.3 Pro (€59 / €590/yr)

Differences vs Companion:

1. **2M tokens / month** (4× Companion).
2. **Premium MCP integrations** — bundled MCP-tool
   adapters for Linear, GitHub Projects, Google Calendar,
   Slack. These run alongside the Kaisho MCP server in the
   same gateway so the AI sees one MCP namespace with
   tools across all five surfaces.
3. **Priority queue** for cloud cron-AI runs — Pro jobs
   run ahead of Companion in the executor.
4. **Priority email support** — operational, not code.

The integrations work is the biggest new surface in this
tier.

### 2.4 Team (€99/seat, min 2)

Differences vs Pro:

1. **Org / workspace concept** — multiple users under one
   billing entity. Today the entire data model is keyed by
   `user_id`. This is the only tier that requires a real
   data-model change.
2. **Shared KB** — `notes`, `tasks`, and a subset of
   `inbox` become org-scoped (with optional per-user
   private space).
3. **Team cron** — agents run in org context, see org
   data, post into org KB.
4. **RBAC** — owner / admin / member.
5. **Audit log** — every MCP call, every cron run, every
   plan-affecting action.
6. **Annual invoice on request** — Stripe quote / invoice
   instead of subscription. Operational, with a small
   invoicing flag column.

---

## 3. Data-model changes

### 3.1 Plan-name migration (week 2)

Single SQL migration: rename plan values.

```sql
-- migrations/013_replan_companion_pro_team.sql
BEGIN;

-- Existing rows: there should be very few. Map sync→companion,
-- sync_ai→pro, free stays free. Team is net-new.
UPDATE users SET plan = 'companion' WHERE plan = 'sync';
UPDATE users SET plan = 'pro'       WHERE plan = 'sync_ai';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_plan_check;
ALTER TABLE users
  ADD CONSTRAINT users_plan_check
  CHECK (plan IN ('free','companion','pro','team'));

COMMIT;
```

Server-side: `config.js` gets a single `PLAN_QUOTAS` map:

```js
const PLAN_QUOTAS = {
  free:      { tokens_per_month:       0 },
  companion: { tokens_per_month:  500_000 },
  pro:       { tokens_per_month: 2_000_000 },
  team:      { tokens_per_month: 2_000_000 }, // per seat
}
```

`requirePlan("companion","pro","team")` and a new
`requireQuotaAvailable()` middleware replace the
`sync`/`sync_ai` checks.

### 3.2 Overage packs (week 2)

One column + one table:

```sql
ALTER TABLE users
  ADD COLUMN bonus_tokens_remaining BIGINT NOT NULL DEFAULT 0;

CREATE TABLE token_packs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tokens          BIGINT NOT NULL,
  stripe_charge_id TEXT UNIQUE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The gateway's quota check becomes `(monthly_used <
monthly_cap) OR (bonus_tokens_remaining > 0)`. Webhook
handler for the pack price ID inserts into `token_packs`
and increments `bonus_tokens_remaining`.

### 3.3 Org / workspace (Team — week 6–8)

The largest schema change. Strategy: a *workspaces* table
plus a *workspace_members* join, and every existing
user-scoped table grows a nullable `workspace_id`.
`workspace_id IS NULL` → personal data (Hobby / Companion
/ Pro). `workspace_id IS NOT NULL` → team data.

```sql
-- migrations/014_workspaces.sql
CREATE TABLE workspaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  owner_id        UUID NOT NULL REFERENCES users(id),
  plan            TEXT NOT NULL DEFAULT 'team',
  seats_purchased INT  NOT NULL DEFAULT 2,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  invoice_only    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE clock_entries  ADD COLUMN workspace_id UUID
  REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE tasks          ADD COLUMN workspace_id UUID
  REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE notes          ADD COLUMN workspace_id UUID
  REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE inbox_entries  ADD COLUMN workspace_id UUID
  REFERENCES workspaces(id) ON DELETE CASCADE;

CREATE INDEX idx_tasks_workspace_updated
  ON tasks(workspace_id, updated_at)
  WHERE workspace_id IS NOT NULL;
-- (and equivalents for notes / inbox / clocks)
```

Read path becomes: "rows where `user_id = me` AND
`workspace_id IS NULL`" *plus* "rows where `workspace_id
IN (workspaces I'm a member of)`". Write path needs a
small policy module that decides which scope to write to
(default = workspace context if active, else personal).

### 3.4 Audit log (Team — week 7)

```sql
CREATE TABLE audit_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id),
  kind         TEXT NOT NULL,  -- 'mcp_call','cron_run','plan_change','seat_add'
  payload      JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_ws_created
  ON audit_events(workspace_id, created_at DESC);
```

Fire-and-forget inserts from the gateway and cron
executor. Owner/admin can read; member can read only their
own rows.

---

## 4. New / changed server surfaces

### 4.1 Hosted MCP gateway (Companion+)

The desktop MCP server runs over stdio against a local
Kaisho. The hosted gateway exposes the same tool surface
over **streamable HTTP** (current MCP transport for remote
servers) so Claude Code, Cursor and Claude Desktop can
reach a tenant's data when the laptop is closed.

**Approach: server-side dispatch against the same Supabase
tables the PWA already reads and writes.** The PWA's
existing write path proves that cloud-first mutations are
safe to round-trip through the desktop's sync engine; the
gateway reuses that path instead of inventing a parallel
one.

This replaces the earlier "WebSocket relay + offline
buffer" design. The relay was written under the assumption
that the desktop is the canonical owner of every write —
true for org-mode files on disk, but the PWA already
violates that assumption every time a user adds a task on
mobile, and the existing sync engine merges those rows
back into the local org files cleanly. The relay would be
solving a problem the sync engine has already solved.

Tool split:

- **Read tools** (`list_tasks`, `list_customers`,
  `search_knowledge`, `list_clock_entries`, `list_inbox`,
  `list_notes`) — direct Supabase SELECTs. 80% of MCP
  traffic. PR A scaffold + PR B (#31).
- **Write tools** (`add_task`, `book_time`,
  `add_inbox_item`, `add_note`, `update_task`,
  `move_task`) — direct Supabase INSERTs / UPDATEs via
  the same validators `/sync` and the PWA already use.
  The desktop sync engine picks them up on the next cycle
  (typically <30 s) and merges them into the local org
  files. #32.

Tools that genuinely need a live laptop (`transcribe_youtube`,
`fetch_url --render`, kb file writes outside the sync scope)
stay desktop-only — those *would* need a WebSocket relay,
but they aren't in the Companion read/write surface and
can be added later as opt-in tools.

Conflict model: last-write-wins by `updated_at`, same as
the PWA today. If the user edits a task in their local
org file at the same moment the AI mutates it via MCP,
the later mutation wins on the next sync. Worth
documenting in the user-facing MCP install guide;
unlikely to bite in practice given typical AI tool-call
cadence.

New route: `api/routes/mcp.js` exposing `POST /mcp`
(MCP Streamable HTTP). One new env var to enable:
`MCP_GATEWAY_ENABLED=true`. Auth via
`Authorization: Bearer <kaisho-api-key>` so the editor
can hit the gateway with the same key the desktop uses.

### 4.2 Hosted cron runner (Companion+)

Today cron lives on the desktop. Companion adds the option
to mirror a job to the cloud:

- New table `cloud_jobs` (id, user_id, name, schedule,
  prompt, model, last_run_at, last_status, …) mirroring
  the local `jobs.yaml` schema.
- New Node worker (separate process, started by
  docker-compose) that runs APScheduler-equivalent in
  Node — `node-cron` for triggers + a small queue table
  for execution. On fire: load prompt, hit the AI gateway
  (counts against the user's quota), persist output back
  via the existing sync endpoints.
- UI: existing desktop cron editor gains a "Run in cloud"
  checkbox; the desktop pushes the job spec to the cloud
  via a new `POST /cloud/jobs` endpoint.

For Pro: a second worker pool with higher priority.

### 4.3 Premium MCP integrations (Pro)

Each integration is a tool-set, not a separate server.
They run inside the same hosted MCP gateway so the AI
sees one namespace.

| Integration       | Tools (read)                | Tools (write)              | Auth     |
|-------------------|------------------------------|----------------------------|----------|
| Linear            | list_issues, get_issue       | create_issue, update_issue | API key  |
| GitHub Projects   | list_projects, list_items    | create_item, move_item     | OAuth    |
| Google Calendar   | list_events, free_busy       | create_event, update_event | OAuth    |
| Slack             | list_channels, search_msgs   | post_message               | OAuth    |

New table:

```sql
CREATE TABLE user_integrations (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,  -- 'linear','github','google','slack'
  credentials  JSONB NOT NULL,  -- encrypted at rest via AES-256-GCM
  scopes       TEXT[],
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
```

Plus an `INTEGRATION_KEY` env var (32 bytes, hex) so
credentials are encrypted at rest using the same pattern
SENAITY now uses for SENAITE creds.

Each integration is one Node module: `api/integrations/
{linear,github,google,slack}.js` exposing `tools()` and
`dispatch(tool, args)`. The MCP gateway concatenates the
user-enabled integration tools with the Kaisho core tools
and returns the union to the AI.

### 4.4 Team workspace API (Team)

New routes under `api/routes/workspace.js`:

```
POST   /workspace                     Create workspace, set owner
GET    /workspace                     My workspaces
GET    /workspace/:id                 Workspace details + members
PATCH  /workspace/:id                 Rename, transfer ownership
DELETE /workspace/:id                 Owner-only
POST   /workspace/:id/members         Invite by email (sends magic link)
DELETE /workspace/:id/members/:userId Remove member
PATCH  /workspace/:id/members/:userId Change role
GET    /workspace/:id/audit           List audit events (admin+)
POST   /workspace/:id/seats           Buy more seats (Stripe quantity update)
```

A new `X-Kaisho-Workspace` header on existing sync /
clocks / tasks / notes / mcp routes selects the workspace
context (defaults to personal). Existing endpoints get a
1-line addition that filters / writes against the chosen
scope.

---

## 5. Billing changes (week 2)

### Stripe product setup

- Archive existing `sync` (€9) and `sync_ai` (€19) prices.
- Create new prices:
  - `companion_monthly` €29 / month
  - `companion_yearly`  €290 / year
  - `pro_monthly`       €59 / month
  - `pro_yearly`        €590 / year
  - `team_monthly`      €99 / seat / month (metered quantity)
  - `team_yearly`       €990 / seat / year
  - `token_pack_500k`   €15 / one-time
- Env: `STRIPE_PRICE_COMPANION_MONTHLY` …
  `STRIPE_PRICE_TOKEN_PACK_500K`. Add to `config.js`
  `PLAN_PRICES`.
- Webhook handler (`stripe-webhook.js`) needs to:
  - Map new price IDs → plan names via `planFromPriceId()`.
  - Handle `quantity` changes on Team subscriptions
    (seats added/removed) → update
    `workspaces.seats_purchased`.
  - On `payment_intent.succeeded` for a token pack:
    insert `token_packs` row + bump
    `users.bonus_tokens_remaining`.

### Pricing UI

The new pricing page (kaisho-website) already advertises
the four tiers — the checkout buttons need to map to the
new price IDs.

---

## 6. Build order — 8-week plan inside the 90-day window

Total ~50 dev-days. Founder budget is ~1 day / week, so
the bulk lands on Coder agents with focused review.

### Weeks 1–2 — "Companion ships"

Goal: a paying customer can buy Companion, get the hosted
token quota, use it from desktop + mobile, and have their
local cron work.

- [ ] Stripe product setup + new env vars (1 d)
- [ ] Migration 013 — replan + plan check constraint (½ d)
- [ ] Migration 014a — `token_packs` + bonus column (½ d)
- [ ] Webhook handler updates: new SKUs + token-pack (1 d)
- [ ] `PLAN_QUOTAS` + `requireQuotaAvailable()` middleware,
      replace `requirePlan("sync","sync_ai")` (1 d)
- [ ] Cap bump 250k → 500k for Companion in `gateway_config`
      (instant — SQL update) (½ h)
- [ ] Overage-pack UI: "Buy 500k more tokens" button in
      desktop settings, wired to Stripe Payment Links (½ d)
- [ ] Email templates: `plan-upgrade-companion`,
      `plan-upgrade-pro`, `token-pack-purchased` (1 d)
- [ ] Update kaisho-website pricing CTAs to new price IDs
      (½ d)

Exit criterion: I can pay €29, see `plan='companion'`,
hit the AI gateway, and observe `ai_usage` increment.

### Weeks 3–4 — "MCP gateway + cron in the cloud"

Goal: a Companion customer can leave the laptop closed and
their Claude Code session can still reach Kaisho. Cron
runs even when offline.

- [ ] New route `api/routes/mcp.js` — streamable HTTP
      endpoint, auth via X-Kaisho-Api-Key (2 d)
- [ ] Server-side dispatch for read tools — port 6 read
      tools to Node, query Supabase directly (3 d)
- [ ] Write-side relay — buffer in `pending_mcp_writes`
      table, replay when desktop WS reconnects (2 d)
- [ ] Install guides: Claude Code, Cursor, Claude Desktop
      (1 d each, can be agent-drafted)
- [ ] Submit to MCP server registries (½ d)
- [ ] New table `cloud_jobs` + `cloud_job_runs` (½ d)
- [ ] Node cron worker (separate compose service) using
      `node-cron` + a queue table (3 d)
- [ ] Desktop UI: "Run in cloud" toggle per job; push job
      spec to `POST /cloud/jobs` (1 d)
- [ ] One showcase template polished: "Monday weekly
      business pulse" (1 d)

Exit criterion: my Claude Code session calls
`mcp.kaisho.dev/streamable`, lists my tasks, books an
hour, and my scheduled "weekly pulse" fires at 7 am
Monday with the laptop closed.

### Weeks 5–6 — "Pro tier ships"

Goal: integrations land. Pro tier becomes the obvious
upgrade for anyone integrating with Linear / GitHub /
Calendar / Slack.

- [ ] Migration 015 — `user_integrations` table + AES
      encryption with `INTEGRATION_KEY` (1 d)
- [ ] OAuth flow + redirect handler in
      `api/routes/integrations.js` (2 d)
- [ ] Linear integration module (1 d — simplest, API-key
      based)
- [ ] GitHub Projects integration module (2 d — OAuth +
      GraphQL)
- [ ] Google Calendar integration module (2 d — OAuth +
      Google's incremental scopes)
- [ ] Slack integration module (1.5 d — OAuth + bot user)
- [ ] MCP gateway: union user-enabled integration tools
      into the response (1 d)
- [ ] Pro priority queue: second worker pool, higher
      concurrency (1 d)
- [ ] Cap bump for Pro to 2M in `gateway_config` (½ h)
- [ ] Settings UI for connecting integrations (1 d)

Exit criterion: I'm on Pro, connect Linear and GitHub in
Settings, then ask Claude Code "find issue MVP-12, post a
PR with the fix, and book the time" — and all three tools
fire.

### Weeks 7–8 — "Team tier ships"

Goal: a 2-person team can buy Team, invite the second
seat, share a KB, and run team cron agents.

- [ ] Migration 014 — `workspaces` + `workspace_members`
      + `workspace_id` columns on existing tables (1 d)
- [ ] Workspace API routes (2 d)
- [ ] Magic-link invite flow (1 d)
- [ ] `X-Kaisho-Workspace` header support across existing
      routes (1.5 d — touches every read/write)
- [ ] Migration 016 — `audit_events` (½ d)
- [ ] Audit instrumentation: gateway, cron, plan-change
      hooks (1 d)
- [ ] RBAC checks (½ d — owner/admin/member matrix)
- [ ] Stripe seat-quantity webhook handling (1 d)
- [ ] Desktop UI: workspace switcher in the profile menu,
      "shared KB" toggle on notes/tasks (2 d)
- [ ] Email templates: `workspace-invite`,
      `workspace-seat-added`, `workspace-billing-update`
      (1 d)
- [ ] Mobile PWA: workspace context picker (1 d)

Exit criterion: my own account is owner of a "Team Test"
workspace, I invite a second email, they join, we both
see the shared "team-pulse" cron output in the shared KB.

### Week 9–12 — buffer + launch

- [ ] Documentation: rebuild kaisho.dev docs for the new
      tiers (mostly existing content, re-shuffled)
- [ ] One-week soft launch to 10 named AI-builder contacts
      (per pivot paper §7 weeks 4–5)
- [ ] Show HN + Product Hunt prep (per §7 weeks 6–7)
- [ ] Fixes from soft-launch feedback
- [ ] Open public launch

---

## 7. Operational concerns

### Quota enforcement

The current gateway already meters; only the cap source
changes from a single `gateway_config.monthly_token_cap`
to `PLAN_QUOTAS[user.plan].tokens_per_month + user.
bonus_tokens_remaining`. One check, one place.

### Cost model

A `claude-haiku-4.5` call averages ~$1.50 / 1M output
tokens (Nov 2026 pricing). Companion's 500k cap costs us
~€0.40 worst-case. Pro's 2M is ~€1.50. At €29 / €59 retail
this is comfortable margin even with peak-user behaviour.

Risk: a user moves entirely to large prompts on
`claude-sonnet-4.5`. Mitigation: `gateway_config.
model_default` is operator-controlled — we route Pro to
Sonnet, Companion to Haiku, downgrade transparently if
margin compresses.

### Single-tenant fallback

For self-hosters who want the hosted-gateway features
without our hosting: the same kaisho-cloud repo runs in a
single `docker-compose up` against their own Supabase
project. The pivot paper §3.5 mentions OSS as the fallback
for Track B; this implementation respects that — every
module added here is OSS-compatible.

### What does NOT ship in 90 days

Explicitly deferred until after the day-90 decision:

- Single Sign-On / SAML (Team plus enterprise)
- Self-hosted enterprise license
- Custom MCP integrations beyond the four bundled
- White-label / reseller program
- Mobile native apps (PWA stays the mobile surface)
- Voice / dictation in mobile
- The lexoffice OAuth invoicing flow already in
  MAKE-OR-DROP.md Track A — only revisited if Team
  customers ask

---

## 8. Risk register (implementation-specific)

| Risk                                    | Likelihood | Impact | Mitigation |
|-----------------------------------------|------------|--------|------------|
| MCP spec changes mid-build              | Medium     | High   | Pin to current spec; relay layer absorbs spec churn |
| OpenRouter pricing volatility           | Medium     | Medium | `gateway_config` model swap = instant SQL update |
| Workspace migration breaks existing user data | Low | High   | All new columns nullable; default behaviour unchanged for plan != team |
| OAuth integrations require security review | High    | Low    | Encrypt at rest, never log credentials, scope minimally per integration |
| Team SKU sales-cycle longer than 90 days| High       | Medium | Companion + Pro are the kill-switch numbers; Team is upside, not a gate |

---

## 9. What I recommend deciding now

Three things to confirm before the Coder agents start:

1. **MCP gateway strategy**: full server-side dispatch, or
   the hybrid (read = server, write = desktop relay)
   recommended here? The hybrid preserves the local-first
   claim but adds offline buffering complexity.
2. **Cron mirroring vs cloud-only**: should Companion cron
   default to local-with-cloud-fallback, or cloud-by-
   default? Recommend cloud-by-default — that's what the
   user is paying for.
3. **Team in 90 days vs Team after**: shipping all three
   tiers in 90 days is ambitious. If anything slips, Team
   slips first. Confirm that's the right priority order
   (it matches `TRACK-AI-METRICS.md` — 20 paying customers
   is the kill switch, and most early customers will be
   Companion/Pro individuals, not Team).

Once those three are decided, weeks 1–2 (Companion ships)
can start immediately and is fully spec'd above.
