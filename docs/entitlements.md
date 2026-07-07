# Entitlements: the free-vs-paid contract

Kaisho is local-first. The desktop and iOS apps are fully
functional on their own on-device storage without an account. The
cloud exists to add two things on top of that local experience:
cross-device sync and the AI assistant. Both require a paid plan.

This document is the authoritative statement of which routes a
free user can reach and which require a subscription. The iOS and
desktop clients rely on it to decide what to show, and the server
enforces it regardless of what any client believes.

## Plans

`free | companion | pro | team`. The paid tiers are ordered:
companion < pro < team. Anything that requires "at least
Companion" is written `requirePlan("companion", "pro", "team")`.

A new account is always created on `free` (see
`POST /auth/signup`, which inserts `users.plan = "free"`). A plan
only ever moves off `free` through a server-verified subscription
from Stripe (web) or Apple (iOS). Clients never send their plan;
the server is the single source of truth and returns it on
`GET /auth/me`.

## What free users can do

Free accounts exist so a user can register, sign in, manage their
account, and start a subscription. None of these are plan-gated:

- `POST /auth/signup` — create an account (assigns `free`)
- `POST /auth/login` — sign in, returns the current `plan`
- `POST /auth/refresh` — refresh the JWT
- `GET  /auth/me` — read `user_id`, `email`, and current `plan`
- `POST /auth/api-key` — rotate the local-sync API key
- `POST /auth/forgot-password`, `POST /auth/reset-password`
- `GET  /billing/subscription` — read subscription status
- `POST /billing/checkout` — start / change a Stripe subscription
- `POST /billing/portal` — open the Stripe billing portal
- `POST /billing/apple/verify` — grant a plan from an iOS IAP
- `GET  /sync/stats`, `GET /sync/status` — report the plan only
  (no user data; `requireAuth` but not `requirePlan`)

The client reads `plan` from `GET /auth/me` and treats anything in
`{companion, pro, team}` as entitled. On the free plan it keeps all
data on-device and hides the sync/AI surfaces.

## What requires a paid plan

Every route that reads or writes synced user data, or spends AI
tokens, is gated with `requirePlan(...)` in `api/middleware.js`. A
free user hitting any of these gets `403 { error: "Plan upgrade
required", current_plan: "free" }`.

| Router / route      | Required plan                    |
| ------------------- | -------------------------------- |
| `/sync/*`           | companion, pro, team             |
| `/clocks/*`         | companion, pro, team             |
| `/ai/*`             | companion, pro, team             |
| `/mcp` (if enabled) | companion, pro, team             |
| `/integrations/*`   | pro, team                        |

The gate lives in one place. Each router calls
`requirePlan("companion", "pro", "team")` (sync uses the
`requireSync` alias) as router-level middleware after
`requireAuth`, so no individual handler can forget it. `/sync/stats`
and `/sync/status` are the only `/sync` routes that stay
`requireAuth`-only, because they return the plan and counts, not
data — a free client polls them to learn it is not entitled.

## Where the plan comes from

`users.plan` is the effective plan, cached ~60s in `requirePlan`
(and up to 5 min in the API-key auth cache in `api/db.js`). A plan
change (upgrade or downgrade) calls `clearPlanCache()` so it takes
effect on the next request.

Today a paid plan is granted by a Stripe subscription: the Stripe
webhook (`api/routes/stripe-webhook.js`) sets `users.plan` on
checkout / renewal and back to `free` on cancellation. iOS in-app
purchases add a second source (Apple) reconciled against Stripe so
that an active subscription from either grants the plan and one
source expiring never wipes a plan the other still grants; see
`docs/apple-iap.md`.

Payment surfaces stay separate: the web UI offers Stripe only, the
iOS app offers Apple IAP only. Neither ever shows the other.

## Enforcement, not decoration

The client-side entitlement check is a UX affordance, nothing
more. The server re-checks the plan on every gated request from the
authoritative `users.plan` value. A client that lies about its plan,
replays an old token, or calls a gated route directly still gets a
`403`. Entitlement always traces back to a server-verified Stripe
or Apple subscription.
