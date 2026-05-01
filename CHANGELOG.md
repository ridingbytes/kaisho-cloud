# Changelog

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
