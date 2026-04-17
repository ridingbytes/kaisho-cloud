# SaaS Setup Guide

This document covers the one-time setup of Supabase, Stripe, and
Resend for the Kaisho Cloud service. Follow these steps when setting
up a new environment from scratch.

---

## 1. Supabase

### Create a project

Go to supabase.com and create a new project. The free tier supports
two active projects (one for SENAITY, one for Kaisho). 500 MB storage
is sufficient for clock entries and reference data.

### Run the database migration

In the Supabase dashboard, open **SQL Editor -> New query**, paste the
contents of `supabase/migrations/001_schema.sql`, and click **Run**.

This creates five tables:

- `users` -- extends Supabase Auth with plan and Stripe IDs
- `clock_entries` -- mobile-created time entries
- `ref_customers` -- read-only customer snapshots from local app
- `ref_tasks` -- read-only task snapshots from local app
- `stripe_events` -- Stripe webhook event IDs for idempotency

All tables have RLS enabled with deny-all policies. The API server
connects with the `service_role` key, which bypasses RLS.

### Enable email auth

Go to **Authentication -> Providers** and ensure Email is enabled.
Disable "Confirm email" for faster onboarding (the welcome email with
API key serves as implicit confirmation), or leave it enabled if you
prefer double opt-in.

### Collect credentials

Go to **Settings -> API**:

- **Project URL** -> `SUPABASE_URL` in `.env`
- **service_role** key (under Legacy API keys) -> `SUPABASE_SERVICE_KEY`

The `service_role` key bypasses RLS. Never expose it in client-side
code.

---

## 2. Stripe

### Create products and prices

Go to **Product catalog -> Add product** and create two products:

| Product        | Price    | Billing |
|----------------|----------|---------|
| Cloud Sync     | EUR 9.00  | Monthly |
| Cloud Sync+AI  | EUR 19.00 | Monthly |

After saving each product, copy the `price_xxx` ID:

- Cloud Sync price ID -> `STRIPE_PRICE_SYNC` in `.env`
- Cloud Sync+AI price ID -> `STRIPE_PRICE_SYNC_AI` in `.env`

Start in **test mode** to wire up the integration before going live.

### Collect the secret key

Go to **Developers -> API keys** and copy the **Secret key**
(`sk_test_...` in test mode, `sk_live_...` in production):

- Secret key -> `STRIPE_SECRET_KEY` in `.env`

### Register the webhook endpoint

Go to **Developers -> Webhooks -> Add endpoint**:

- **Endpoint URL:** `https://cloud.kaisho.dev/billing/webhook/stripe`
- **Events:**
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `customer.deleted`

After saving, reveal the signing secret (`whsec_...`):

- Signing secret -> `STRIPE_WEBHOOK_SECRET` in `.env`

### Enable the Customer Portal

Go to **Settings -> Customer portal** and enable it:

- Allow customers to update subscriptions
- Allow customers to cancel subscriptions
- Show invoice history

The `/billing/portal` endpoint creates portal sessions on request.

---

## 3. Resend

### Create an API key

Go to resend.com, create an account, and generate an API key:

- API key -> `RESEND_API_KEY` in `.env`

### Configure sender domain

Add and verify the sender domain (e.g. `kaisho.dev`) in the Resend
dashboard under **Domains -> Add domain**. Add the SPF, DKIM, and
DMARC DNS records to the domain zone and wait for Resend to confirm
all three are valid.

Set the sender address:

- `EMAIL_FROM=Kaisho <noreply@kaisho.dev>` in `.env`

---

## 4. Complete .env file

Once Supabase, Stripe, and Resend are set up, create `.env` from
`.env.example` and fill in all values:

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc...

STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_SYNC=price_...
STRIPE_PRICE_SYNC_AI=price_...

RESEND_API_KEY=re_...
EMAIL_FROM=Kaisho <noreply@kaisho.dev>

BASE_URL=https://cloud.kaisho.dev
PORT=3000
```

On the VPS, the file must be owned by root with permissions `600`:

```bash
chmod 600 /home/docker/kaisho-cloud/.env
```

---

## 5. Test cards (Stripe test mode)

| Scenario  | Card number         | Result                  |
|-----------|---------------------|-------------------------|
| Success   | 4242 4242 4242 4242 | Payment accepted        |
| 3D Secure | 4000 0025 0000 3155 | Authentication required |
| Decline   | 4000 0000 0000 9995 | insufficient_funds      |

Any future expiry date and any CVC work for all test cards.

---

## 6. Supabase CLI

Install the CLI for managing migrations:

```bash
brew install supabase/tap/supabase
```

Link to the cloud project once per machine:

```bash
supabase login
supabase link --project-ref <project-ref>
```

The project ref is the subdomain of the Supabase URL
(`https://<project-ref>.supabase.co`).

**Push a new migration**

```bash
supabase db push
```

**Check migration status**

```bash
supabase migration list
```

**Pull remote schema changes**

```bash
supabase db pull
```

---

## 7. User management

### Query users

Use `psql` with the connection string from
**Settings -> Database -> Connection string**:

```bash
psql "postgresql://postgres:<password>@<host>:5432/postgres" -c \
  "SELECT u.id, au.email, u.plan, u.created_at
   FROM users u
   JOIN auth.users au ON au.id = u.id
   ORDER BY u.created_at DESC;"
```

### Grant a user a paid plan (pilot users)

```sql
UPDATE users
SET plan = 'sync_ai'
WHERE id = '<user-id>';
```

The change takes effect on the next API call.

### Delete a user

```sql
-- Delete from users table (cascades to clock_entries,
-- ref_customers, ref_tasks)
DELETE FROM users WHERE id = '<user-id>';

-- Also delete from Supabase Auth
SELECT auth.delete_user('<user-id>');
```

If the user has a Stripe subscription, cancel it in the Stripe
dashboard first.

---

## 8. Switching to live mode

1. Complete business verification in the Stripe dashboard.
2. Switch to **live mode** in the Stripe dashboard.
3. Recreate the two products and prices in live mode. Copy the
   new `price_...` IDs.
4. Register a new webhook endpoint in live mode:
   - **Endpoint URL**: `https://cloud.kaisho.dev/billing/webhook/stripe`
   - **Events**: same as above
   Copy the new signing secret.
5. Verify the sender domain in Resend (SPF, DKIM, DMARC).
6. Update `.env` on the VPS with live-mode keys.
7. Restart: `docker compose pull && docker compose up -d`
8. Place a test purchase to confirm the webhook flow.

---

## 9. Upgrading the stack

```bash
cd /home/docker/kaisho-cloud
docker compose pull
docker compose up -d
```

The API server is stateless (all state lives in Supabase), so the
brief restart is safe.

### Rollback

Pin a known-good image tag in `docker-compose.yml`:

```yaml
image: ghcr.io/ridingbytes/kaisho-cloud:abc1234
```

Then `docker compose up -d`.

---

## 10. Troubleshooting

### Container logs

```bash
docker logs kaisho-cloud --tail 100 -f
```

### Health check

```bash
curl https://cloud.kaisho.dev/health
# Expected: {"status":"ok"}
```

---

## 9. OpenRouter (AI Gateway)

The Sync + AI plan routes AI requests through OpenRouter. This
provides access to multiple model providers (Anthropic, Google,
OpenAI) through a single API key.

### Create an account

Go to openrouter.ai, create an account, and add credit ($5 is
enough to start). Generate an API key at openrouter.ai/keys.

### Configure

Add to `.env` on the VPS:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

Optional model overrides (defaults are sensible):

```bash
# Fast model for NLP time booking (cheap, structured extraction)
AI_MODEL_FAST=google/gemini-2.0-flash-lite-001

# Default model for summaries and advisor (quality)
AI_MODEL_DEFAULT=anthropic/claude-sonnet-4
```

### Token metering

Each user on the Sync + AI plan has a soft cap of 200,000
tokens per month. Usage is tracked in the `ai_usage` table
and resets on the first of each month. Requests over the cap
return 429.

### Endpoints

| Route | Model | Purpose |
|-------|-------|---------|
| `POST /ai/complete` | MODEL_DEFAULT | General AI completion |
| `POST /ai/parse-booking` | MODEL_FAST | NLP time booking with regex fallback |
| `POST /ai/summarize` | MODEL_DEFAULT | Weekly/monthly summaries |
| `GET /ai/usage` | -- | Current month token usage |

---

### Common issues

| Symptom                        | Likely cause                        | Fix                                           |
|--------------------------------|-------------------------------------|-----------------------------------------------|
| All API calls return 503       | Container crashed                   | `docker compose up -d`; check logs            |
| POST /auth/login returns 500   | Supabase unreachable                | Check SUPABASE_URL and key; verify project    |
| Stripe webhook returns 400     | Wrong STRIPE_WEBHOOK_SECRET         | Ensure secret matches live/test mode          |
| Webhook processed twice        | Duplicate delivery                  | Normal; stripe_events table deduplicates      |
| Email not delivered            | Resend domain not verified          | Check SPF/DKIM/DMARC in Resend dashboard      |
| Supabase project paused        | Free tier inactivity (1 week)       | Resume in Supabase dashboard                  |
