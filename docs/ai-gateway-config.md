# AI Gateway Configuration

The cloud AI gateway routes Kaisho desktop and PWA AI
requests through OpenRouter, meters per-user usage, and
enforces a monthly token cap. Two configuration layers
sit above the env-var defaults so changes can be made
without redeploying or restarting the container.

## Layers, most specific first

1. **Per-user override** — columns on the `users` table.
2. **Global config** — single row in the `gateway_config`
   table.
3. **Env vars** — fallback when the table is empty or
   Supabase is briefly unreachable.
4. **Code defaults** — last-resort baked-in values.

The gateway caches the global config for 60 seconds. SQL
changes take effect within a minute, no restart needed.

## Schema

### `gateway_config` (single row, `id = 1`)

| column | type | default |
|---|---|---|
| `backend_url` | text | `https://openrouter.ai/api/v1/chat/completions` |
| `backend_api_key_env` | text | `OPENROUTER_API_KEY` |
| `backend_label` | text | `openrouter` |
| `monthly_token_cap` | int | 250000 |
| `model_advisor` | text | `anthropic/claude-haiku-4.5` |
| `model_cron` | text | `google/gemma-4-31b-it` |
| `model_default` | text | `anthropic/claude-haiku-4.5` |
| `max_tokens_per_request` | int | 8192 |

The gateway POSTs to `backend_url` in OpenAI chat-completions
format. The API key is **not stored in the database** — only
the env-var name (`backend_api_key_env`). On each request the
gateway resolves `process.env[backend_api_key_env]`. This keeps
secrets out of the DB and lets you rotate keys via the VPS env
without touching the table.

### Defensive constraints

These guard against operator errors and against the scenario
where someone has SQL write access but not the runtime env:

- **`backend_url` must be `https://`** — prevents an
  accidental row from sending the master key as a cleartext
  Bearer token. Enforced at the DB level (CHECK constraint).
- **`backend_api_key_env` must be on a code-level
  allowlist** (`OPENROUTER_API_KEY`, `OLLAMA_CLOUD_API_KEY`,
  `LITELLM_API_KEY`). A row with an arbitrary name (e.g.
  `STRIPE_SECRET_KEY`) is logged and the gateway falls back
  to the env default. To approve a new backend, add its env
  var to `ALLOWED_BACKEND_KEY_ENVS` in `api/routes/ai.js`
  and redeploy.
- **`advisor_model_override` and `cron_model_override`
  must be in `ALLOWED_MODELS`** — an unrecognised slug is
  logged and the user falls through to the gateway_config
  default.
- **`monthly_token_cap_override` must be `0..10_000_000`**
  — a typo (negative or unbounded value) won't silently
  disable metering. Enforced at the DB level.

### `users` overrides

| column | type | meaning |
|---|---|---|
| `monthly_token_cap_override` | int / null | NULL = use global cap |
| `advisor_model_override` | text / null | NULL = use global advisor model |
| `cron_model_override` | text / null | NULL = use global cron model |

## Common ops

### Bump the cap globally

```sql
UPDATE gateway_config
SET monthly_token_cap = 300000
WHERE id = 1;
```

### Try a different advisor model for everyone

```sql
UPDATE gateway_config
SET model_advisor = 'anthropic/claude-sonnet-4-6'
WHERE id = 1;
```

To roll back, point it at the old model again. Cache TTL
means rollback is also live within 60 seconds.

### Grant a single user extended usage

```sql
UPDATE users
SET monthly_token_cap_override = 500000
WHERE id = 'USER_UUID';
```

Effective cap for that user becomes 500000; everyone else
still sees the global cap. To revert, set the column back
to NULL.

### Suspend a user's AI access without revoking the plan

```sql
UPDATE users
SET monthly_token_cap_override = 0
WHERE id = 'USER_UUID';
```

Returns 429 on every AI call. Useful for billing holds,
abuse investigation, or pause-without-cancel scenarios.

### Beta-test Sonnet with one user

```sql
UPDATE users
SET advisor_model_override = 'anthropic/claude-sonnet-4-6'
WHERE id = 'USER_UUID';
```

That user's advisor calls go to Sonnet; everyone else
stays on the configured advisor model.

### Switch backend (e.g. to Ollama Cloud)

Two-step:

1. Add the new API key to the VPS env and restart the
   container once:

   ```sh
   # /etc/kaisho-cloud.env
   OLLAMA_CLOUD_API_KEY=...
   ```

2. Single SQL transaction flips the backend + models +
   nukes per-user overrides that referenced the old
   provider's slugs:

   ```sql
   BEGIN;
   UPDATE gateway_config
   SET backend_url =
         'https://ollama.com/v1/chat/completions',
       backend_api_key_env = 'OLLAMA_CLOUD_API_KEY',
       backend_label = 'ollama_cloud',
       model_advisor = 'qwen3:32b',
       model_cron = 'gemma3:27b',
       model_default = 'qwen3:32b'
   WHERE id = 1;

   UPDATE users
   SET advisor_model_override = NULL,
       cron_model_override = NULL;
   COMMIT;
   ```

Within ~60s, all traffic goes to the new backend. Roll
back with the inverse transaction.

To switch to a self-hosted LiteLLM proxy (which speaks
OpenRouter-style slugs), only the URL and key need to
change — model names stay valid:

```sql
UPDATE gateway_config
SET backend_url = 'https://litellm.internal/v1/chat/completions',
    backend_api_key_env = 'LITELLM_API_KEY',
    backend_label = 'litellm'
WHERE id = 1;
```

### Inspect current overrides

```sql
SELECT id, plan,
       monthly_token_cap_override,
       advisor_model_override,
       cron_model_override
FROM users
WHERE monthly_token_cap_override IS NOT NULL
   OR advisor_model_override IS NOT NULL
   OR cron_model_override IS NOT NULL;
```

## Resolution order for the cap

```
users.monthly_token_cap_override
  → gateway_config.monthly_token_cap
    → MONTHLY_TOKEN_CAP env var
      → 250000 (code default)
```

## Resolution order for the model

For `mode = "advisor"`:

```
users.advisor_model_override
  → gateway_config.model_advisor
    → AI_MODEL_ADVISOR env var
      → "anthropic/claude-haiku-4.5" (code default)
```

Same shape for `mode = "cron"` and `mode = "default"`.

## Env vars (fallback layer)

These still work and are read only when the
`gateway_config` table is empty or unreachable. They are
overridable per deploy via the VPS environment.

| var | meaning |
|---|---|
| `BACKEND_URL` | fallback backend endpoint |
| `BACKEND_API_KEY_ENV` | fallback name of the env var holding the key |
| `BACKEND_LABEL` | fallback backend label |
| `OPENROUTER_API_KEY` | the actual key, looked up by name |
| `AI_MODEL_ADVISOR` | fallback advisor model |
| `AI_MODEL_CRON` | fallback cron model |
| `AI_MODEL_KAISHO_DEFAULT` | fallback default-mode model |
| `AI_MODEL_DEFAULT` | legacy `model` field default (parse-booking, summarize) |
| `AI_MODEL_FAST` | fast model for parse-booking regex fallback |
| `AI_ALLOWED_MODELS` | allowlist for legacy `model` field |

`MONTHLY_TOKEN_CAP` exists in code as a constant but is
not currently exposed via env — the migration seeds the
table with the same default. If you ever drop the table
and want a different env-driven default, expose it in
`getGatewayConfig`'s catch branch.

## Operational notes

### Adding a new model to the allowlist

`ALLOWED_MODELS` is a code-level set populated from
either the `AI_ALLOWED_MODELS` env var or a hardcoded
list in `api/routes/ai.js`. Setting
`gateway_config.model_advisor` to a slug **not** in this
set will be rejected with a warning log and the gateway
will fall back to the env default.

To add a new model:

1. Set `AI_ALLOWED_MODELS=<existing>,new/model:slug` on
   the VPS env, **or** edit the hardcoded list in code
   and ship a release.
2. Restart the container so the new env is read.
3. `UPDATE gateway_config SET model_advisor = 'new/model:slug' WHERE id = 1;`
4. Within ~60s the per-worker config cache picks it up.

If you skip step 1, advisor calls keep using the env
fallback and you'll see warnings in logs. No data is
lost — just a silent degrade.

### Cache propagation across workers

When running multiple Express workers (PM2 cluster), each
has its own 60-second config cache. A single SQL change
to `gateway_config` propagates within ~60s **per worker**
independently. During that window, traffic to different
workers may see mixed configurations.

If you need instant propagation, restart the workers
after the SQL change: `pm2 restart kaisho-cloud`. For
true online consistency, subscribe to Supabase Realtime
on the `gateway_config` table and clear the cache on
NOTIFY (not currently implemented).

### `ai_usage` table retention

The `ai_usage` table grows by one row per (user, month).
Retention is unbounded today. At some scale (say >12
months × N users beyond what's interesting) consider:

- Archive rows older than 13 months to a cold table or
  a CSV in object storage
- Or just drop them — billing has already happened, and
  the per-user UI only shows the current month

A `pg_cron` job or external script can do this; not
urgent below 1k users.

### Desktop client retry contract

`POST /ai/complete` returns 5xx if the AI request
succeeded but `recordUsage` failed (e.g.
`increment_ai_usage` RPC missing or DB error). The
desktop and PWA clients should **not** retry on 5xx from
`/ai/*` — a retry could double-bill if the first call's
RPC eventually commits. Treat 5xx as "this request is
final; show an error".

If automated retry becomes a UX requirement, add a
client-supplied request id and an idempotency table on
the gateway side that returns the cached response for
duplicate ids.
