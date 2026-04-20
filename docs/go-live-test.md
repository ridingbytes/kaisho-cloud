# Go-Live Test Script

Complete end-to-end test of the Kaisho Cloud user journey.
Run this in Stripe **test mode** before switching to live keys.

Prerequisites: local kaisho-cloud running via `bin/dev`
(port 3030) or deployed to the staging/production VPS.

Test cards (Stripe test mode):

| Card               | Result             |
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
- [ ] Confirm connection succeeds and shows plan = Free
- [ ] Press "Sync Now" — confirm it is blocked or returns
      an error (free tier has no sync access)
- [ ] Disconnect


## Phase 2 — Upgrade with Trial

### 2.1 Subscribe to Cloud Sync

- [ ] In the PWA profile, tap "Cloud Sync"
- [ ] Stripe Checkout opens — use card 4242...4242
- [ ] Confirm: Checkout shows "14-day free trial"
      (no charge today, first charge in 14 days)
- [ ] Complete checkout
- [ ] Confirm: PWA profile now shows plan = **Cloud Sync**
- [ ] Confirm: upgrade email received

### 2.2 Sync works

- [ ] Desktop app: connect with same API key
- [ ] Confirm connection shows plan = Cloud Sync
- [ ] Start a timer on desktop, stop it
- [ ] Press "Sync Now" — confirm entry appears in PWA
- [ ] Start a timer in the PWA, stop it
- [ ] Press "Sync Now" on desktop — confirm entry appears
- [ ] Edit an entry on desktop, sync, confirm PWA updated
- [ ] Delete an entry on desktop, sync, confirm gone in PWA

### 2.3 Cloud timer cross-device

- [ ] Start a timer in the PWA (mobile)
- [ ] Desktop should show "Running on mobile" with a
      stop button in the clock widget
- [ ] Stop the cloud timer from desktop
- [ ] Confirm the completed entry syncs to both sides

### 2.4 AI is blocked on sync-only plan

- [ ] Desktop: Settings > Cloud Sync — confirm "Use Kaisho
      AI" toggle is disabled (greyed out)
- [ ] Confirm no AI usage meter is shown


## Phase 3 — Plan Upgrade (Sync → Sync + AI)

### 3.1 Upgrade in-app

- [ ] PWA profile: tap "Upgrade to Sync + AI"
- [ ] Stripe shows prorated amount (or trial extension)
- [ ] Complete checkout
- [ ] Confirm: PWA shows plan = **Sync + AI**
- [ ] Confirm: AI usage meter appears in PWA profile

### 3.2 Cloud AI works

- [ ] Desktop: Settings > Cloud Sync — enable "Use
      Kaisho AI" toggle (should be clickable now)
- [ ] Open the Advisor, ask a question
- [ ] Confirm the response shows a model name
      (e.g. `anthropic/claude-sonnet-4`)
- [ ] Confirm AI usage meter in Settings > Cloud Sync
      increments after the request
- [ ] PWA profile: confirm usage meter also shows the
      same token count

### 3.3 Cron with Cloud AI

- [ ] Create a cron job with "Kaisho AI" toggle enabled
- [ ] Trigger it manually
- [ ] Confirm it runs and produces output
- [ ] Confirm AI usage meter increments


## Phase 4 — Disconnect / Reconnect

### 4.1 Disconnect from desktop

- [ ] Desktop: Settings > Cloud Sync > Disconnect
- [ ] Confirm: "Flushing cloud data..." animation shows
- [ ] Confirm: success message with entry count removed
- [ ] Check Supabase: `clock_entries` for this user
      should be empty
- [ ] Check Supabase: `ref_customers` for this user
      should be empty
- [ ] Desktop: confirm local entries are still intact
- [ ] Desktop: confirm Cloud Sync shows "Not connected"

### 4.2 Reconnect

- [ ] Desktop: connect again with the same API key
- [ ] Press "Sync Now"
- [ ] Confirm: local entries are pushed to the cloud
- [ ] PWA: confirm entries are visible again
- [ ] Start/stop a timer on each side, sync, confirm
      bidirectional sync still works


## Phase 5 — Cancellation

### 5.1 Cancel via portal

- [ ] PWA profile: tap "Manage Subscription"
- [ ] Stripe Customer Portal opens
- [ ] Cancel the subscription
- [ ] Confirm: portal shows "Cancels at end of period"
- [ ] Back in PWA: profile may still show the paid plan
      (cancellation is at period end, not immediate)

### 5.2 Subscription ends

- [ ] In Stripe Dashboard (test mode): find the
      subscription, click "..." > "Cancel immediately"
      (simulates period end)
- [ ] Wait for webhook to fire
- [ ] Confirm: PWA profile shows plan = **Free**
- [ ] Confirm: cancellation email received
- [ ] Desktop: press "Sync Now" — confirm it is blocked
- [ ] Confirm: AI toggle reverts to disabled

### 5.3 Re-subscribe (no second trial)

- [ ] PWA profile: tap "Cloud Sync" again
- [ ] Confirm: Stripe Checkout does NOT show a trial
      (user already has a stripe_customer_id)
- [ ] Complete checkout with card 4242...4242
- [ ] Confirm: charged immediately, plan = Cloud Sync
- [ ] Confirm: sync works again


## Phase 6 — Edge Cases

### 6.1 Declined card

- [ ] Sign up with a new account
- [ ] Upgrade to Cloud Sync using decline card
      4000 0000 0000 9995
- [ ] Confirm: checkout fails, user stays on Free plan
- [ ] Confirm: no webhook event changes the plan

### 6.2 3D Secure

- [ ] Use card 4000 0025 0000 3155
- [ ] Complete 3D Secure authentication in the Stripe
      test UI
- [ ] Confirm: plan upgrades to Cloud Sync after auth

### 6.3 Duplicate webhook delivery

- [ ] In Stripe Dashboard > Webhooks: resend a
      `checkout.session.completed` event
- [ ] Confirm: `stripe_events` table deduplicates it
- [ ] Confirm: user plan is unchanged (no side effects)

### 6.4 Sync ID removed in Emacs

- [ ] Open an org-mode clock entry in Emacs
- [ ] Remove the SYNC_ID property
- [ ] Sync from desktop
- [ ] Confirm: entry is re-adopted via content matching
      (same customer + start time), not duplicated

### 6.5 Plan cache expiry

- [ ] With a paid plan active, note the time
- [ ] Cancel the subscription immediately in Stripe
- [ ] Within 60 seconds (cache TTL), press Sync Now
      on desktop
- [ ] Confirm: sync either works (cache still valid)
      or fails gracefully after cache expires
- [ ] After 60 seconds, confirm sync is blocked

### 6.6 Ollama Cloud config migration

- [ ] If settings.yaml has `ollama_url: https://api.ollama.com`
      from the old setup, confirm that:
  - [ ] The AI settings page shows the URL in the local
        Ollama field (harmless but won't fetch models)
  - [ ] Moving the URL to "Ollama Cloud URL" and the key
        to "Ollama Cloud Key" restores model detection
  - [ ] Models appear with `ollama_cloud:` prefix


## Phase 7 — Webhook Endpoint Verification

- [ ] Stripe Dashboard > Webhooks: confirm all recent
      events show status 200
- [ ] Confirm no events are stuck in "Failed" or "Pending"
- [ ] Trigger each event type manually and verify:
  - [ ] `checkout.session.completed` — plan set
  - [ ] `customer.subscription.updated` — plan updated
  - [ ] `invoice.paid` — plan confirmed
  - [ ] `customer.subscription.deleted` — downgrade to free
  - [ ] `customer.deleted` — full cleanup


## Sign-off

All phases passed: [ ] Yes  [ ] No

Date: _______________

Notes:
