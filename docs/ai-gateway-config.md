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
| `monthly_token_cap` | int | 250000 |
| `model_advisor` | text | `anthropic/claude-haiku-4.5` |
| `model_cron` | text | `google/gemma-4-31b-it` |
| `model_default` | text | `anthropic/claude-haiku-4.5` |
| `max_tokens_per_request` | int | 8192 |

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
| `MONTHLY_TOKEN_CAP` | unused at the moment — see note below |
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
