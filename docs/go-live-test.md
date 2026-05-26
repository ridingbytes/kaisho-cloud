# Go-Live Test Script

Complete end-to-end test of the Kaisho Cloud user journey on
the Track AI tiers. Run this in Stripe **test mode** before
switching to live keys.

Prerequisites: local kaisho-cloud running via `bin/dev`, or
deployed to the staging/production VPS.

Tiers under test:

| Plan       | Price       | Sync | AI  | Premium integrations | Tokens/mo |
|------------|-------------|------|-----|----------------------|-----------|
| Free       | --          | no   | no  | no                   | --        |
| Companion  | EUR 29/mo   | yes  | yes | no                   | 500k      |
| Pro        | EUR 59/mo   | yes  | yes | yes                  | 2M        |
| Team       | EUR 99/seat | yes  | yes | yes                  | 2M        |
| Token Pack | EUR 15      | one-time top-up: +500k bonus tokens          |

Team is a "Contact us" tier (no self-serve checkout); this
script covers Free, Companion, Pro and the Token Pack.

Test cards (Stripe test mode):

| Card                | Result             |
|---------------------|--------------------|
| 4242 4242 4242 4242 | Success            |
| 4000 0025 0000 3155 | 3D Secure required |
| 4000 0000 0000 9995 | Decline            |

Use any future expiry date and any 3-digit CVC.


## Phase 1 — Free Tier

### 1.1 Signup

- [ ] Open the PWA (`/m/`)
- [ ] Sign up with a fresh email address
- [ ] Confirm: profile shows plan = **Free**
- [ ] Confirm: no credit card was required

### 1.2 Free tier limitations

- [ ] Start a timer, stop it, verify the entry appears
- [ ] Open the desktop app, go to Settings > Cloud Sync
- [ ] Connect with the API key from the PWA
- [ ] Confirm: connect is rejected — Cloud Sync requires a
      paid plan (Companion or higher)
- [ ] PWA Advisor: confirm it is gated (upgrade prompt, no
      chat input)


## Phase 2 — Subscribe to Companion

### 2.1 Subscribe (with trial)

- [ ] In the PWA profile, tap **Upgrade** and choose
      **Companion**
- [ ] Stripe Checkout opens — use card 4242...4242
- [ ] Confirm: Checkout shows the trial (no charge today,
      first charge after the trial) and applies tax /
      collects a tax id if configured
- [ ] Complete checkout
- [ ] Confirm: PWA profile now shows plan = **Companion**
- [ ] Confirm: token meter shows the 500k monthly cap
- [ ] Confirm: upgrade email received

### 2.2 Sync works

- [ ] Desktop: Settings > Cloud Sync — connect with the
      same API key; confirm plan = Companion
- [ ] Start a timer on desktop, stop it, Sync Now — confirm
      it appears in the PWA
- [ ] Start a timer in the PWA, stop it, Sync Now on desktop
      — confirm it appears
- [ ] Edit then delete an entry on desktop, sync, confirm
      the PWA reflects both

### 2.3 Cloud timer cross-device

- [ ] Start a timer in the PWA (mobile)
- [ ] Desktop shows "Running on mobile" with a stop button
- [ ] Stop the cloud timer from desktop; confirm the
      completed entry syncs to both sides

### 2.4 AI works (Companion)

- [ ] Desktop: Settings > Cloud Sync — "Use Kaisho AI" is
      enabled (Companion includes AI)
- [ ] Advisor: ask "How many hours did I work this week?"
      — confirm it answers from real data and the token
      meter increments on both desktop and PWA
- [ ] PWA Advisor: ask the same — confirm it answers
      (server-side advisor loop)

### 2.5 Integrations are Pro-only

- [ ] Desktop: Settings > Integrations — confirm GitHub is
      connectable (free), but Linear / Slack / Google are
      greyed with a "Pro only" note


## Phase 3 — Upgrade Companion to Pro

### 3.1 Upgrade

- [ ] PWA profile: tap **Upgrade to Pro**
- [ ] Stripe shows a prorated amount; complete checkout
- [ ] Confirm: PWA shows plan = **Pro**, token meter shows
      the 2M cap
- [ ] Confirm: upgrade email received

### 3.2 Premium integrations unlock

- [ ] Desktop: Settings > Integrations — Linear / Slack /
      Google are now connectable
- [ ] Connect Google Calendar (OAuth in the browser),
      return and Refresh — confirm it shows connected
- [ ] Advisor (desktop and PWA): ask "What's on my calendar
      tomorrow?" — confirm it calls the calendar and answers
- [ ] External MCP client (optional): point Claude/Cursor at
      `cloud.kaisho.dev/mcp` and confirm the integration
      tools appear


## Phase 4 — Token Pack

- [ ] PWA profile: tap **Buy token pack** (EUR 15, 500k)
- [ ] Complete checkout with card 4242...4242 (one-time,
      no subscription)
- [ ] Confirm: bonus token balance increases by 500k
- [ ] Confirm: purchase email received
- [ ] Resend the `checkout.session.completed` event from
      the Stripe Dashboard — confirm the balance does **not**
      double (idempotent `credit_token_pack`)


## Phase 5 — Disconnect / Reconnect

### 5.1 Disconnect from desktop

- [ ] Desktop: Settings > Cloud Sync > Disconnect
- [ ] Confirm: "Flushing cloud data..." then a success
      message with the entry count removed
- [ ] Supabase: `clock_entries` and `ref_customers` for this
      user are empty
- [ ] Desktop: local entries are intact; Cloud Sync shows
      "Not connected"

### 5.2 Reconnect

- [ ] Desktop: connect again with the same API key, Sync Now
- [ ] Confirm: local entries are pushed; PWA shows them
      again; bidirectional sync still works


## Phase 6 — Cancellation

### 6.1 Cancel via portal

- [ ] PWA profile: tap "Manage Subscription"
- [ ] Stripe Customer Portal opens; cancel the subscription
- [ ] Confirm: portal shows "Cancels at end of period"
- [ ] PWA may still show the paid plan until period end

### 6.2 Subscription ends

- [ ] Stripe Dashboard (test mode): find the subscription,
      "..." > "Cancel immediately" (simulates period end)
- [ ] Wait for the webhook to fire
- [ ] Confirm: PWA profile shows plan = **Free**
- [ ] Confirm: cancellation email received
- [ ] Desktop: Sync Now is blocked; "Use Kaisho AI" reverts
      to disabled; integration tools no longer offered

### 6.3 Re-subscribe (no second trial)

- [ ] PWA profile: subscribe to Companion again
- [ ] Confirm: Checkout does NOT show a trial (the user
      already has a `stripe_customer_id`)
- [ ] Complete checkout; confirm charged immediately, plan =
      Companion, sync works again


## Phase 7 — Edge Cases

### 7.1 Declined card

- [ ] Fresh account; upgrade with decline card
      4000 0000 0000 9995
- [ ] Confirm: checkout fails, user stays on Free; no
      webhook changes the plan

### 7.2 3D Secure

- [ ] Use card 4000 0025 0000 3155; complete 3DS in the
      Stripe test UI
- [ ] Confirm: plan upgrades after authentication

### 7.3 Duplicate webhook delivery

- [ ] Stripe Dashboard > Webhooks: resend a
      `checkout.session.completed` event
- [ ] Confirm: `stripe_events` deduplicates it; plan and
      token balance unchanged

### 7.4 Sync ID removed in Emacs

- [ ] Open an org-mode clock entry, remove the SYNC_ID
      property, sync from desktop
- [ ] Confirm: the entry is re-adopted via content matching
      (same customer + start time), not duplicated

### 7.5 Plan cache expiry

- [ ] With a paid plan active, cancel immediately in Stripe
- [ ] Within 60s (cache TTL), Sync Now may still work
- [ ] After 60s, confirm sync is blocked

### 7.6 Quota exhaustion

- [ ] Drive AI usage to the monthly cap (or lower the cap in
      `gateway_config` for the test)
- [ ] Confirm: `/ai/*` returns 429 with a quota message and
      the meter shows the cap reached
- [ ] Buy a token pack; confirm requests succeed again
      against the bonus balance


## Phase 8 — Webhook Endpoint Verification

- [ ] Stripe Dashboard > Webhooks: all recent events show
      status 200; none stuck in Failed/Pending
- [ ] Trigger each event type and verify:
  - [ ] `checkout.session.completed` — plan set (sub) /
        tokens credited (one-time)
  - [ ] `customer.subscription.updated` — plan updated
  - [ ] `invoice.paid` — plan confirmed
  - [ ] `customer.subscription.deleted` — downgrade to Free
  - [ ] `customer.deleted` — full cleanup


## Sign-off

All phases passed: [ ] Yes  [ ] No

Date: _______________

Notes:
