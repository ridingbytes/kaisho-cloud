# Changelog

## 2.2.1

Project detail becomes a real workspace, plus mobile polish
from live testing.

- Show linked tasks, notes and time in the project detail [#93](https://github.com/ridingbytes/kaisho-cloud/pull/93)
- Keep detail-screen nav buttons fully visible on narrow screens [#94](https://github.com/ridingbytes/kaisho-cloud/pull/94)
- Colour the task status in a project's linked-task list [#95](https://github.com/ridingbytes/kaisho-cloud/pull/95)

## 2.2.0

Projects come to the cloud and the PWA, and the mobile app
gets a native-feeling editor overhaul with a full round of
sync fixes from live testing.

- Add cloud sync support for projects [#83](https://github.com/ridingbytes/kaisho-cloud/pull/83)
- Unify all editors on a modern Modal + Field kit [#84](https://github.com/ridingbytes/kaisho-cloud/pull/84)
- Add Projects to the PWA [#85](https://github.com/ridingbytes/kaisho-cloud/pull/85)
- Assign projects at creation time and show them on rows [#86](https://github.com/ridingbytes/kaisho-cloud/pull/86)
- Rework editors into stacked view-first detail screens [#87](https://github.com/ridingbytes/kaisho-cloud/pull/87)
- PWA: don't drop tasks with non-default statuses [#88](https://github.com/ridingbytes/kaisho-cloud/pull/88)
- PWA: render task statuses in the desktop's configured order [#89](https://github.com/ridingbytes/kaisho-cloud/pull/89)
- PWA: explicit Delete in every detail editor [#90](https://github.com/ridingbytes/kaisho-cloud/pull/90)
- Translate projects + delete-confirm strings (es, ru, de) [#91](https://github.com/ridingbytes/kaisho-cloud/pull/91)
- Drop dead CSS from the editor redesign [#92](https://github.com/ridingbytes/kaisho-cloud/pull/92)

### Migrations

- `021_projects.sql` — `projects` table plus the
  `project` / `milestone` reference columns on `tasks`,
  `notes`, and `clock_entries`.
- `022_wipe_projects.sql` — fold `projects` into the
  `wipe_user_sync_state` RPC.

Both applied to the kaisho-cloud Supabase before this tag
was cut.

## 2.1.0

A cleanup + hardening release that rolls up the post-2.0.0
review findings, dev-tooling improvements, and the Stripe
tax-behaviour fix on the token-pack one-off prices.

- Extract sync.js resource factory (closes #77) [#81](https://github.com/ridingbytes/kaisho-cloud/pull/81)
- kaisho-cloud cleanup: closes #63, #78, #79 [#80](https://github.com/ridingbytes/kaisho-cloud/pull/80)
- API + scripts cleanup: dedup, dead code, JSDoc placement, logger consistency [#76](https://github.com/ridingbytes/kaisho-cloud/pull/76)
- Docs: align dev port, drop dead webhook call, move strategy docs [#75](https://github.com/ridingbytes/kaisho-cloud/pull/75)
- Drop legacy api_key_prefix fallback in requireApiKey [#74](https://github.com/ridingbytes/kaisho-cloud/pull/74)
- bin/dev: detect + offer to kill stale Kaisho server on port [#73](https://github.com/ridingbytes/kaisho-cloud/pull/73)
- dev-stripe.sh: make Ctrl+C actually stop 'stripe listen' [#72](https://github.com/ridingbytes/kaisho-cloud/pull/72)
- Token-pack Checkout missing USt: set explicit tax_behavior on prices [#71](https://github.com/ridingbytes/kaisho-cloud/pull/71)
- scripts: add dev-stripe.sh wrapper for symlinked ~/.config setups [#70](https://github.com/ridingbytes/kaisho-cloud/pull/70)
- PWA: Team is a 'Contact us' mailto, not a subscribe button [#69](https://github.com/ridingbytes/kaisho-cloud/pull/69)

### Migrations

- `020_find_user_by_email.sql` — SECURITY DEFINER RPC used
  by the password-reset flow (replaces the
  `auth.admin.listUsers()` scan that #63 eliminated).
  Applied to production before this tag was cut.

## 2.0.0

The Track AI release: hosted plans (Companion / Pro), premium
integrations, the hosted MCP gateway, the server-side agentic
advisor, and the mobile PWA — aligned with `kaisho` 2.0.0.

- Track AI plan rollout: rename tiers, add PLAN_QUOTAS, handle token-pack purchases [#22](https://github.com/ridingbytes/kaisho-cloud/pull/22)
- Token-pack purchase email + Track AI tier copy refresh [#23](https://github.com/ridingbytes/kaisho-cloud/pull/23)
- scripts: idempotent Stripe webhook endpoint syncer [#24](https://github.com/ridingbytes/kaisho-cloud/pull/24)
- scripts: read-only Stripe setup audit [#25](https://github.com/ridingbytes/kaisho-cloud/pull/25)
- MCP gateway scaffold (Companion+, behind feature flag) [#26](https://github.com/ridingbytes/kaisho-cloud/pull/26)
- MCP gateway read tools (Companion+) [#27](https://github.com/ridingbytes/kaisho-cloud/pull/27)
- MCP gateway write tools (Companion+) [#28](https://github.com/ridingbytes/kaisho-cloud/pull/28)
- Cloud cron jobs schema + CRUD API (Companion+) [#29](https://github.com/ridingbytes/kaisho-cloud/pull/29)
- Extract AI gateway core into api/ai/engine.js [#30](https://github.com/ridingbytes/kaisho-cloud/pull/30)
- Build Docker runtime stage with pnpm, drop stale package-lock.json [#31](https://github.com/ridingbytes/kaisho-cloud/pull/31)
- Hosted cron worker (Companion+) [#32](https://github.com/ridingbytes/kaisho-cloud/pull/32)
- Run the cron worker in production compose [#33](https://github.com/ridingbytes/kaisho-cloud/pull/33)
- Invalidate the auth cache on plan change, not just PLAN_CACHE [#34](https://github.com/ridingbytes/kaisho-cloud/pull/34)
- Cron worker overlap guard, timeout, and fresh job re-read [#35](https://github.com/ridingbytes/kaisho-cloud/pull/35)
- Atomic token-pack credit to close concurrent-purchase + retry races [#36](https://github.com/ridingbytes/kaisho-cloud/pull/36)
- Harden book_time date validation and cloud-job PATCH [#37](https://github.com/ridingbytes/kaisho-cloud/pull/37)
- Surface Companion AI advisor + token balance in the PWA [#38](https://github.com/ridingbytes/kaisho-cloud/pull/38)
- In-app purchase flow (subscribe + token pack) in the PWA [#39](https://github.com/ridingbytes/kaisho-cloud/pull/39)
- Encrypted integration credential store (Pro foundation) [#40](https://github.com/ridingbytes/kaisho-cloud/pull/40)
- Linear integration + management API (Pro) [#41](https://github.com/ridingbytes/kaisho-cloud/pull/41)
- GitHub Projects integration (Pro) [#42](https://github.com/ridingbytes/kaisho-cloud/pull/42)
- Union premium integration tools into the MCP gateway (Pro) [#43](https://github.com/ridingbytes/kaisho-cloud/pull/43)
- OAuth flow + Slack integration (Pro) [#44](https://github.com/ridingbytes/kaisho-cloud/pull/44)
- Plan-priority queue on the AI gateway (Pro) [#45](https://github.com/ridingbytes/kaisho-cloud/pull/45)
- Purge legacy sync/sync_ai plan references + refresh docs [#46](https://github.com/ridingbytes/kaisho-cloud/pull/46)
- Google Calendar integration (Pro) — completes the Pro tier [#47](https://github.com/ridingbytes/kaisho-cloud/pull/47)
- Integration tool dispatch endpoint (for the desktop advisor) [#48](https://github.com/ridingbytes/kaisho-cloud/pull/48)
- Server-side agentic advisor loop (`/ai/advisor`) [#49](https://github.com/ridingbytes/kaisho-cloud/pull/49)
- Fix advisor tool schemas to JSON Schema draft 2020-12 [#50](https://github.com/ridingbytes/kaisho-cloud/pull/50)
- Accept date-only args in the Google Calendar tools [#51](https://github.com/ridingbytes/kaisho-cloud/pull/51)
- Harden the advisor loop: validate tool args, gate integrations by plan, meter per round [#52](https://github.com/ridingbytes/kaisho-cloud/pull/52)
- PWA advisor uses the server-side agentic loop (`/ai/advisor`) [#53](https://github.com/ridingbytes/kaisho-cloud/pull/53)
- Rewrite the go-live test script around the Track AI tiers [#54](https://github.com/ridingbytes/kaisho-cloud/pull/54)
- Fix yearly checkout charging the monthly price [#55](https://github.com/ridingbytes/kaisho-cloud/pull/55)
- Make the Stripe webhook idempotency lock atomic (insert-first) [#56](https://github.com/ridingbytes/kaisho-cloud/pull/56)
- Fail the AI token-quota check closed on a usage-read error [#57](https://github.com/ridingbytes/kaisho-cloud/pull/57)

## 1.3.1

PWA + API patch. Companion to ``kaisho`` 1.5.1.

### Multi-style avatars on the mobile PWA

The desktop app gained a per-user ``avatar_style`` field
in 1.5.1. The cloud now carries that field end-to-end so
the mobile PWA renders the same avatar style the user
picked on the desktop.

- ``POST /sync/reference`` schema accepts the optional
  ``avatar_style`` field on the embedded config object.
  The value flows verbatim into the ``ref_config`` JSONB
  blob and is returned by ``GET /ref/config``.
- Mobile PWA's ``PixelAvatar`` is rewritten as a
  multi-style renderer (``invaders`` default,
  ``pixel-art`` / ``bottts`` / ``adventurer`` via DiceBear).
  All four styles render fully client-side -- no DiceBear
  HTTP API, the seed never leaves the device. DiceBear
  styles are lazy-imported so only the renderer in use
  ships in the runtime chunk.
- The header avatar in the PWA picks up
  ``appConfig.avatar_style`` automatically.

## 1.3.0

PWA-focused release. Desktop-app changes are tracked in the
`kaisho` repo's CHANGELOG.

### Features

- **Advisor → Inbox**: small icon in each assistant reply
  (top-left timestamp, bottom-right save icon, both inside
  the bubble) saves the answer to the inbox via the existing
  add-inbox API. Synced to desktop on the next cycle. Saved
  state persists across page reloads
- **Timer styling parity with desktop**: monospace elapsed
  counter, font-weight 300, tabular-nums; pulsing green
  "Active" pill replaces the previous green digits
- **Inline markdown notes** on the running timer: full-height
  textarea with debounced auto-save, live preview when not
  editing (tap to switch back to raw)
- **Editable customer/task/contract** on a running timer via
  an Edit button → bottom-sheet editor (the same one used
  for historical entries; now includes a Task select)
- **Pause / Resume** on Stop: the just-stopped timer stays
  pinned with a frozen elapsed counter, a green Resume
  button (one-tap re-fire of the same customer/description)
  and a neutral Clear button (drops the snapshot, returns
  to the empty start form)
- Cross-device pin: a stop initiated on desktop now pins the
  PWA in the same Resume/Clear state, and a start on another
  device drops the local pin
- Filled-red Stop / filled-green Resume circular buttons,
  sized below the elapsed font for visual hierarchy

### Improvements

- Markdown task lists (`- [ ] foo` / `- [x] done`) render
  with the checkbox inline next to the label and no
  redundant bullet
- Bullet markers in the notes preview no longer clip
  against the rounded card border (proper list padding)
- Replaces the pill-shaped "Save to inbox" button beside
  each assistant reply with a small icon inside the bubble,
  alongside an `HH:MM · kaisho:advisor` header

## 1.2.5

- Operational documentation in `docs/ai-gateway-config.md`:
  the allowlist-update workflow when adding a new model
  to `gateway_config`, per-Express-worker cache
  propagation behaviour (~60s per worker), `ai_usage`
  retention guidance, and the desktop retry contract for
  `/ai/*` 5xx (do not retry — risk of double-billing
  via `recordUsage`)

## 1.2.4

- Fix sync echo loop. `/sync/apply` (and inbox/task/note
  variants) stamped a fresh `updated_at` on every write,
  which made every locally-pushed entry come back on the
  next pull (cloud's `updated_at` > client's pull cursor)
  → applied locally → re-pushed → echoed forever. Symptom:
  clicking Sync alternated "8 pulled" / "8 pushed"
  indefinitely. Fix: honor the client's `updated_at` for
  LWW correctness; only stamp fresh when the client
  didn't supply one (defensive).

## 1.2.3

- Move `crypto = require("crypto")` to the top of
  `api/routes/ai.js` to match the imports-on-top
  convention. No behaviour change

## 1.2.2

- Validate `gateway_config.model_advisor` /
  `model_cron` / `model_default` against
  `ALLOWED_MODELS`. Closes a defense-in-depth gap from
  1.2.1: per-user overrides were validated, but a SQL
  write to `gateway_config` could still route every
  user to an arbitrary slug. Same allowlist now applied
  on both paths
- Widen `ALLOWED_BACKEND_KEY_ENVS` to include
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `GOOGLE_API_KEY` so operators using direct provider
  APIs (instead of OpenRouter / LiteLLM) don't hit a
  silent fallback
- Drop the `recordUsage` upsert fallback. The fallback
  overwrote the existing `ai_usage` row with the
  current request's tokens instead of incrementing,
  silently corrupting metering whenever the
  `increment_ai_usage` RPC errored. Fail loudly now —
  the request 5xxs and the operator gets paged
- Redact `backend_api_key_env` in the log line that
  fires when an unknown name is rejected. The value is
  attacker-controlled (DB write); echoing it verbatim
  is a log-injection vector. Log a SHA-256 prefix
  instead so operators can correlate without exposing
  the literal value

## 1.2.1

- Defense-in-depth on the gateway runtime config
  introduced in 1.2.0:
- `ALLOWED_BACKEND_KEY_ENVS` allowlist (in code, not
  DB) — `gateway_config.backend_api_key_env` only
  resolves the env-var name when it's on this list.
  Prevents secret-key exfiltration via SQL write
  (e.g. setting it to `STRIPE_SECRET_KEY`)
- `ALLOWED_MODELS` validation on per-user
  `advisor_model_override` / `cron_model_override`
  values. An unknown slug logs a warning and falls
  through to the gateway_config default
- Migration 012 adds DB CHECK constraints:
  `backend_url LIKE 'https://%'` (no cleartext key in
  flight) and `monthly_token_cap_override BETWEEN 0
  AND 10000000` (a sign-typo can't disable metering)

## 1.2.0

- `gateway_config` table (single row, id=1) holds
  global runtime defaults: backend URL,
  backend API-key env-var name, backend label,
  monthly token cap, model per mode (advisor/cron/
  default), max tokens per request. Cached for 60s in
  the gateway so SQL changes propagate without a
  restart
- Per-user override columns on `users`:
  `monthly_token_cap_override`,
  `advisor_model_override`, `cron_model_override`. NULL
  = use the gateway_config value
- API keys are NOT stored in the DB; only the env-var
  name is. The gateway resolves
  `process.env[backend_api_key_env]` per request, so
  keys rotate via VPS env without table touches
- `GET /ai/usage` now returns the resolved (per-user)
  cap so the desktop and PWA token meters reflect any
  override automatically
- Backend swaps (e.g. OpenRouter → Ollama Cloud or
  LiteLLM) become a single SQL transaction once the
  new env var is set on the VPS — no code change

## 1.1.1

- PWA advisor: fix scroll bug where pulling up to read
  a long answer triggered pull-to-refresh and reloaded
  the page, wiping the conversation. AdvisorView is
  now rendered outside the PullToRefresh wrapper;
  `.advisor-messages` gets `overscroll-behavior:
  contain` so gestures stay local
- PWA advisor: persist conversation to `localStorage`
  (`kaisho.advisor.messages.v1`); survives reload and
  navigation
- PWA advisor: Clear button (with confirmation) wipes
  state and storage
- PWA advisor: forward last 20 messages to the gateway
  on each turn so follow-up questions land in context.
  Fresh data context is injected only on the latest
  user message
- PWA advisor: send `mode: "advisor"` so the gateway
  routes through Haiku 4.5 instead of `MODEL_DEFAULT`

## 1.1.0

- Mode-based model routing on `POST /ai/complete`. New
  `mode` field (advisor / cron / default) picks the
  upstream model server-side. Replaces the previous
  Sonnet-for-everything default for the advisor path
- Mode → model defaults: advisor →
  anthropic/claude-haiku-4.5, cron →
  google/gemma-4-31b-it, default →
  anthropic/claude-haiku-4.5. Each overridable via env
- Monthly token cap raised 200K → 250K
- Mode-routed requests bypass the legacy `model`-field
  allowlist because the gateway picks the model itself

## 1.0.0

- Initial cloud sync API: clock entries, customers,
  tasks. Bidirectional sync with sync_id-based
  identity. Supabase Auth + RLS deny-all
- AI gateway routes `/ai/complete`, `/ai/parse-booking`,
  `/ai/summarize` to OpenRouter using a single master
  key. Per-user metering in `ai_usage`
- Stripe billing for the Sync ($X) and Sync+AI ($Y)
  plans
- PWA shell with Timer, Tasks, Inbox, Advisor,
  Notes, Dashboard, Book, Entries
