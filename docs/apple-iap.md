# Apple in-app purchases (iOS)

The iOS app sells the Companion subscription through
StoreKit 2. This document covers the server side: how a
purchase becomes a plan, how it reconciles with Stripe, and
the exact contract the StoreKit client calls.

Apple IAP is iOS-only. The web PWA stays Stripe-only and
never surfaces anything Apple. Plan resolution recognises an
active subscription from either source, but each source is
offered on its own surface.

## Product ids

Create these auto-renewable subscription products in App
Store Connect (bundle id `dev.kaisho.app`):

| Product id                          | Plan      | Period  |
| ----------------------------------- | --------- | ------- |
| `dev.kaisho.app.companion.monthly`  | companion | monthly |
| `dev.kaisho.app.companion.yearly`   | companion | yearly  |

Both map to the `companion` plan. The ids can be overridden
with `APPLE_PRODUCT_COMPANION_MONTHLY` /
`APPLE_PRODUCT_COMPANION_YEARLY` if they are named
differently in App Store Connect, but the defaults above are
what the app ships with. Higher tiers are not sold on iOS
today; add a row (and env var) here when one is.

## The client contract

After a successful purchase, the app sends the transaction's
`jwsRepresentation` to the verify endpoint.

    POST /billing/apple/verify
    Authorization: Bearer <supabase-jwt>
    Content-Type: application/json

    { "signedTransaction": "<Transaction.jwsRepresentation>" }

`signedTransaction` is the compact JWS string StoreKit hands
back (`VerificationResult.jwsRepresentation` for the
`Transaction`). Any authenticated user may call it, including
one currently on `free` — that is how they subscribe.

Success (`200`):

    {
      "plan": "companion",
      "effective_plan": "companion",
      "expires_at": "2026-08-07T12:00:00.000Z",
      "environment": "Production"
    }

- `plan` — the plan this Apple product grants.
- `effective_plan` — the reconciled plan after considering
  any Stripe subscription too (never lower than `plan`). The
  client should treat `effective_plan` as the entitlement,
  though in practice it also re-reads `GET /auth/me`.
- `expires_at` — ISO 8601 expiry of the current period.
- `environment` — `Production` or `Sandbox`.

Errors (all JSON `{ "error": "<code>" }`):

| Status | code                  | Meaning                        |
| ------ | --------------------- | ------------------------------ |
| 400    | `invalid_signature`   | JWS failed Apple verification  |
| 400    | `wrong_bundle_id`     | bundleId is not `dev.kaisho.app` |
| 400    | `wrong_environment`   | env not in `APPLE_ENVIRONMENT` |
| 400    | `unknown_product`     | productId maps to no plan      |
| 400    | `not_subscription`    | transaction has no expiry      |
| 409    | `expired`             | subscription already lapsed    |
| 409    | `revoked`             | transaction was refunded       |
| 409    | `already_linked`      | purchase belongs to another    |
|        |                       | account                        |
| 503    | (not configured)      | server has no Apple root cert  |

After a `200`, the client should refresh `GET /auth/me` so
the rest of the app picks up the new plan.

## How a grant is stored and reconciled

`users.plan` is the single effective plan the API enforces.
It is never written directly by a payment handler. Each
source records its own grant:

- Stripe → `users.stripe_plan`
- Apple → `users.apple_plan`, `users.apple_expires_at`,
  `users.apple_original_transaction_id`,
  `users.apple_product_id`, `users.apple_environment`

`resolveEffectivePlan()` (`api/billing/plans.js`) sets
`users.plan` to the highest active tier across both sources,
where Apple counts only while `apple_expires_at` is in the
future. `reconcilePlan()` (`api/billing/reconcile.js`) runs
it and clears the plan caches. Consequences:

- An active subscription from either source grants the plan.
- One source expiring never wipes a plan the other still
  grants (a lapsed Apple sub leaves an active Stripe plan
  intact, and vice versa).
- The Stripe cancellation email only sends when reconciliation
  actually drops the user to `free`.

Renewals, expirations and refunds arrive as App Store Server
Notifications V2; see that endpoint for the downgrade path.

## Verifying Apple's signature

Every StoreKit transaction is a JWS whose `x5c` header
carries the certificate chain leaf → intermediate → Apple
root. `verifyAppleJws()` (`api/billing/apple/jws.js`, node
`crypto` only) checks that the chain links to a pinned Apple
root, that every certificate is inside its validity window,
and that the JWS signature verifies against the leaf key.
Nothing in the payload is trusted before that passes, and the
client can never self-grant a plan.

## Configuration

See `.env.example` for the full list. Summary:

- `APPLE_BUNDLE_ID` (default `dev.kaisho.app`)
- `APPLE_ENVIRONMENT` (default `Production`; set
  `Production,Sandbox` during App Review)
- `APPLE_PRODUCT_COMPANION_MONTHLY` /
  `APPLE_PRODUCT_COMPANION_YEARLY` (defaults above)
- `APPLE_ROOT_CA_PATH` — directory holding
  `AppleRootCA-G3.cer`. Download it from
  https://www.apple.com/certificateauthority/ and drop it in
  `api/billing/apple/certs/` (see the README there). Without
  it, the verify endpoint returns `503`. This is Apple's App
  Store root, distinct from the Developer ID code-signing
  certificates used to notarize the desktop app.

The App Store Server API credentials (issuer id, key id, and
the `.p8` private key) are only needed for server-initiated
status lookups and the notification path; they are documented
with the notifications work.
