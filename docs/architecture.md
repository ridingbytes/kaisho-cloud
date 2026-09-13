# Kaisho Cloud Architecture

This document describes the data flows, authentication, sync
protocol, and AI gateway that connect the local Kaisho desktop
app, the Kaisho Cloud server, and the mobile PWA.


## System Overview

```
+------------------+     +-----------------+     +-------------+
|  Kaisho Desktop  |<--->|  Kaisho Cloud   |<--->|  Mobile PWA |
|  (local app)     |     |  (Express/VPS)  |     |  (browser)  |
+------------------+     +-----------------+     +-------------+
        |                        |
        v                        v
   Local files            +------------+     +-------------+
   (org/md/json)          | PostgreSQL |     |  OpenRouter  |
                          |  (in-stack)|     |  (AI proxy)  |
                          +------------+     +-------------+
```

**Local app**: Python/FastAPI backend + React frontend. Stores
all data as plain text files (org-mode, Markdown, or JSON).
Runs `kai serve` on port 8766 (dev) or 8765 (desktop).

**Cloud server**: Node.js/Express on a VPS. Handles
authentication, bidirectional sync (clocks, inbox, tasks,
notes), mobile PWA serving, and AI gateway
proxying.

**Mobile PWA**: React SPA served by the cloud server. Provides
timer, entries, book, tasks, inbox, notes, dashboard, and AI
features on mobile.

**PostgreSQL**: In-stack database for user accounts, clock
entries, reference data, and AI usage tracking.

**OpenRouter**: AI inference gateway. Provides access to Claude,
Gemini, GPT-4 and other models through a single API.


## Authentication

Two auth paths depending on the client:

### Mobile PWA (JWT)

```
Mobile -> POST /auth/login { email, password }
       <- { access_token, refresh_token }
       -> Bearer <access_token> on all requests
       -> POST /auth/refresh when 401 received
```

JWTs are issued and verified by this server (HS256, signed
with `JWT_SECRET`); there is no network call. The user ID from the
JWT is used for all database queries.

### Desktop App (API Key)

```
Desktop -> Bearer <api_key> on all requests
        -> Cloud compares bcrypt hash against users.api_key_hash
        -> SHA-256 fast cache (5 min TTL) skips bcrypt on repeat calls
```

API keys are generated in the mobile PWA's profile view. The
key is shown once and stored as a bcrypt hash in the `users`
table. The desktop app stores it in `settings.yaml`.

After the first successful bcrypt comparison, the API key is
cached by its SHA-256 hash for 5 minutes. Subsequent requests
hit the fast cache in O(1) without any bcrypt or database
round-trip.

### Combined Auth Middleware

The `requireAuth` middleware tries JWT first (tokens longer than
50 characters), then falls back to API key auth. This allows
both the mobile PWA and the desktop app to use the same
endpoints.


## Real-Time Updates (WebSocket)

The cloud server runs a WebSocket endpoint at `/ws` for
pushing state changes to connected clients in real time.

### Connection and Auth

Two auth mechanisms are supported:

**First-message auth** (preferred): the client connects
without credentials in the URL and sends a JSON message
as its first frame:

```
ws.send({"type": "auth", "token": "<jwt>"})
```

The server waits up to 5 seconds for this message. If no
valid auth message arrives, the connection is closed with
code 4001.

**Query-string auth** (legacy): credentials are passed as
URL parameters:

```
wss://cloud.kaisho.dev/ws?token=<jwt>
wss://cloud.kaisho.dev/ws?api_key=<key>
```

Both paths use the same JWT/API-key validation as HTTP
routes. Each authenticated connection is registered in a
per-user socket map (`userId -> Set<WebSocket>`).

### Events

| Event | Payload | Trigger |
|-------|---------|---------|
| `connected` | `{ devices }` | On successful auth |
| `timer:started` | entry | POST /clocks/start, /sync/active/start |
| `timer:stopped` | entry | POST /clocks/stop, /sync/active/stop |
| `entries:changed` | `{ count }` | POST /sync/apply, PATCH /clocks/:id |
| `entries:deleted` | `{ ids }` | DELETE /clocks/:id |
| `inbox:changed` | `{ count }` | POST /sync/inbox/apply |
| `tasks:changed` | `{ count }` | POST /sync/tasks/apply |
| `notes:changed` | `{ count }` | POST /sync/notes/apply |

### Heartbeat and Reconnect

Server pings every 30 seconds; clients that miss two pings
are terminated. The mobile WS client reconnects with
exponential backoff (1s to 30s) and +/-20% jitter to prevent
thundering herd on server restarts.

### Polling Fallback

The mobile PWA uses WebSocket events as the primary refresh
trigger but also re-fetches on `visibilitychange` (visible)
to catch updates missed while the iOS PWA was backgrounded
(iOS suspends WebSocket connections in the background).

### Optimistic UI and Suppression

Timer start/stop use optimistic updates (show the state
change immediately, confirm with the API in the background).
A 3-second suppression window ignores incoming WS events
after a local mutation to prevent the server's broadcast
from reverting the optimistic state.


## Bidirectional Sync Protocol

The sync protocol ensures clock entries stay consistent between
the local app and the cloud. Local files are always the source
of truth.

### Identity

Every clock entry carries a UUID (`SYNC_ID` in org files,
`clock_entries.id` in the cloud). This ID is shared between
local and cloud representations of the same entry.

### Sync Cycle

The local app runs a sync cycle periodically (default: every
5 minutes) and on every local mutation:

```
1. PULL  — GET /sync/changes?since=<cursor>
           Fetch entries changed since last pull.
           Apply to local files using last-writer-wins.

2. PUSH TOMBSTONES — POST /sync/apply
           Push local deletes (soft-delete on cloud).

3. PUSH LIVE — POST /sync/apply
           Push locally-changed entries in 400-entry batches.
           Running timers use POST /sync/active/start instead.

4. INBOX — GET /sync/inbox/changes, POST /sync/inbox/apply
           Pull and push inbox items (same LWW protocol).

5. TASKS — GET /sync/tasks/changes, POST /sync/tasks/apply
           Pull and push tasks (same LWW protocol).

6. NOTES — GET /sync/notes/changes, POST /sync/notes/apply
           Pull and push notes (same LWW protocol).

7. CONFIG PULL — GET /ref/config
           Pull user_name changes from the PWA and
           update local user.yaml.

8. SNAPSHOT — POST /sync/push-snapshot
           Push customer/task reference data, tags,
           avatar_seed, and user_name so the mobile
           PWA has dropdown options and synced settings.
```

### Echo-Back Prevention

When the local app pulls a change (e.g. a status update from
the PWA), applying it locally updates the entry's timestamp.
Without protection, the push phase would send this entry back
to the cloud, potentially overwriting a newer PWA change via
LWW. To prevent this, each `pull_and_apply_*` function returns
the set of sync IDs it touched. The corresponding
`collect_*_changes` function excludes those IDs from the push.

### Batch Optimization

The `/sync/apply` endpoint processes batches efficiently:

1. **Single SELECT**: all incoming entry IDs are fetched in one
   query to build an `existingMap` for merge decisions.
2. **Batch INSERT**: new entries are inserted in a single query.
3. **Individual UPDATE**: existing entries are updated one at a
   time (each needs its own `WHERE user_id = ?` for RLS safety).

This reduces the N+1 query pattern to 1 + 1 + U queries (where
U is the number of updates), compared to 2N before.

### Conflict Resolution

**Last-writer-wins** by `updated_at` timestamp. When pulling:

- If the cloud entry is newer than local, overwrite local.
- If local is newer, skip (it will be pushed in step 3).
- Deleted entries carry `deleted_at` and are removed locally.

### Cursor Semantics

- `last_pull_cursor`: tracks the cloud's latest `updated_at`.
- `last_push_cursor`: bumped after each push so already-synced
  entries don't round-trip.
- On initial connect, push cursor starts at epoch so all local
  entries are pushed.

### Active Timer Reconciliation

Only one timer can be active per user. When the local app and
mobile both start a timer, the "later `start_at` wins" rule
applies. The losing timer is auto-stopped at the winner's
start time.

### Timezone Handling

Local timestamps are naive (system timezone). Cloud timestamps
are UTC (TIMESTAMPTZ). The sync layer converts:

- **Push**: `_local_to_utc()` before sending to cloud
- **Pull**: `_utc_to_local()` before writing to local files

### Disconnect

When a user disconnects:

1. Final pull (best-effort)
2. DELETE /sync/entries — wipes all clock entries, ref_customers,
   and ref_tasks from the cloud
3. Clear local cursor and tombstones

Local files are untouched. Reconnecting triggers a full push.


## AI Gateway

The cloud server proxies AI requests to OpenRouter, providing
a single API key and metered usage per user.

### Architecture

```
Local App                Cloud Gateway           OpenRouter
     |                        |                       |
     |-- prompt + tools ----->|--- forward ---------->|
     |                        |   (add API key,       |
     |                        |    meter tokens)      |
     |<-- tool_calls ---------|<-- tool_calls --------|
     |                        |                       |
     | (execute tools         |                       |
     |  locally in Python)    |                       |
     |                        |                       |
     |-- results + tools ---->|--- forward ---------->|
     |                        |                       |
     |<-- final answer -------|<-- answer ------------|
```

### Agentic Tool Calling

The local app runs a multi-turn agentic loop:

1. Send prompt + tool definitions to `POST /ai/complete`
2. Cloud forwards to OpenRouter with tools
3. If the model returns `tool_calls`, the local app executes
   them (Python functions accessing local data)
4. Tool results are appended to the message history
5. Next turn is sent to the cloud
6. Repeat until the model returns a final text answer

**Max turns**: 15 per request (prevents runaway loops).

### Server-Side Advisor (`/ai/advisor`)

Thin clients (the mobile PWA) cannot drive the agentic loop
themselves the way the desktop app does. `POST /ai/advisor`
runs the **entire loop on the server**: the client sends only
the conversation, and the cloud calls the model, executes any
tool calls, feeds the results back, and returns the final
answer.

```
Thin client            Cloud Advisor (/ai/advisor)      OpenRouter
     |                        |                              |
     |-- messages ----------->|--- model call (w/ tools) --->|
     |                        |<-- tool_calls ---------------|
     |                        | run tool (Postgres /         |
     |                        |   integration dispatch)      |
     |                        |--- results + tools --------->|
     |                        |<-- final answer -------------|
     |<-- text + tools_used --|                              |
```

- **Toolset**: harvested from the same registrars the MCP
  gateway uses, so there is one definition per tool. Read +
  write kaisho tools for every paid plan; the user's
  connected premium integrations (`google_*`, `slack_*`,
  `linear_*`, `github_*`) only for `pro` / `team`, matching
  the MCP gateway's plan gate.
- **Args validation**: tool args from the model are validated
  against each tool's Zod schema before the handler runs
  (the MCP SDK does this on the wire; the internal loop does
  it explicitly). Validation errors are returned to the model
  so it can correct itself.
- **Bounds**: at most `MAX_STEPS` (6) model rounds; the final
  round is run without tools to force a prose answer. Per
  round output is capped at 2048 tokens (4096 max).
- **Metering**: usage is recorded per round, so tokens are
  metered even if a later round fails. The loop stops
  requesting tools once cumulative usage would reach the
  monthly cap, then forces a final answer.

The desktop app keeps its own local loop (it has tools that
touch local org files); `/ai/advisor` is for clients that
have no local toolset of their own.

### Available Tools

| Category | Tools |
|----------|-------|
| Tasks | list, add, move, update, archive, set tags |
| Clock | list, book, start, stop, update, invoice |
| Customers | list, list contracts |
| Inbox | list, add |
| Notes | list, add, update, delete |
| Knowledge | search, read, write, list files |
| Web | search, fetch URL |
| GitHub | list issues, list projects |
| YouTube | transcribe |
| CLI | execute kai subcommands |
| Cron | list jobs, trigger |
| Backup | create, list |

### Security Guardrails

**Cloud mode restrictions** (enforced by the local executor):

- Blocked tools: `delete_profile`, `rename_profile`,
  `trigger_cron_job`, `create_backup`, `approve_url_domain`
- `execute_cli`: only safe `kai` subcommands allowed
  (`ask`, `briefing`, `customer`, `clock`, `task`, `note`,
  `kb`, `cron`, `tag`, `config`, `version`)
- Write limit: 3 mutations per cron job run
- URL fetch: domain allowlist enforced
- No shell injection: `shlex.split()` + subprocess list form
- 60-second timeout per CLI command

### Models

| Use Case | Model | Config |
|----------|-------|--------|
| Fast parsing (NLP booking) | gemini-2.0-flash-lite | AI_MODEL_FAST |
| Summaries and advisor | claude-sonnet-4 | AI_MODEL_DEFAULT |

### Token Metering

Usage is tracked per user per month in the `ai_usage` table.
The `increment_ai_usage` Postgres function provides atomic
counter updates. Each `/ai/complete` call records input and
output tokens. Monthly soft cap: 200,000 tokens (returns 429
when exceeded).

### Kaisho AI Toggle

- **Global toggle** in Cloud Sync settings enables Kaisho AI
- **Advisor**: always uses Kaisho AI when the toggle is on
- **Cron jobs**: per-job `use_kaisho_ai` flag. Jobs that need
  external access (web search, URL fetch) work through the
  agentic loop. Jobs can opt out to use local Ollama instead.

### Mobile PWA Tool Calling

The PWA's AI advisor also supports tool calling. Unlike the
local app (which has 32 tools), the PWA exposes three tools
that create entities via the sync API:

| Tool | Action |
|------|--------|
| `add_task` | Creates a task via POST /sync/tasks/apply |
| `add_inbox_item` | Creates an inbox item via POST /sync/inbox/apply |
| `add_note` | Creates a note via POST /sync/notes/apply |

The agentic loop runs client-side in `api.ts` (up to 5 turns).
Tool calls are executed locally in the browser using the
existing sync API functions. Created items sync to the desktop
app through the normal sync cycle.

### Mobile AI Endpoints

| Endpoint | Model | Purpose |
|----------|-------|---------|
| POST /ai/parse-booking | FAST | NLP time entry parsing |
| POST /ai/summarize | DEFAULT | Weekly/monthly summaries |
| POST /ai/complete | DEFAULT | General completion + tools |
| GET /ai/usage | -- | Current month token stats |


## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `users` | Account: email, bcrypt password hash, API key hash |
| `clock_entries` | Synced time entries (TIMESTAMPTZ, soft-delete) |
| `projects` | Synced projects (LWW, soft-delete) |
| `cloud_jobs` | Scheduled AI jobs |
| `cloud_job_runs` | Per-run record for those jobs |
| `cron_health` | Heartbeat from the cron worker |
| `gateway_config` | Single-row AI gateway settings |
| `user_integrations` | Encrypted OAuth credentials |
| `inbox_entries` | Synced inbox items (LWW, soft-delete) |
| `tasks` | Synced tasks (LWW, soft-delete) |
| `notes` | Synced notes (LWW, soft-delete) |
| `ref_customers` | Read-only customer snapshots from local app |
| `ref_tasks` | Read-only task snapshots from local app |
| `ref_config` | Synced settings: tags, avatar, user_name, feature flags |
| `ai_usage` | Per-user per-month token counters |

All tables have RLS enabled with deny-all policies. The API
server uses the service role key to bypass RLS.


## Deployment

The cloud server runs as a Docker container on a VPS behind
Traefik with automatic TLS (Let's Encrypt). A file provider
config (`traefik/kaisho-cloud.yml`) routes
`cloud.kaisho.dev` to the container. The deploy workflow
pins images to the exact Git SHA for reproducible deploys.

Environment variables configure all external services
(Resend, OpenRouter). See
[deployment.md](deployment.md) for the full setup and
[self-hosting.md](self-hosting.md) for the third-party service
configuration.
