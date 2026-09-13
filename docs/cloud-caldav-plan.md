# Cloud-side CalDAV — design + phased delivery for 2.3

Status: planning. No code in this document. Each phase
is independently shippable; user approves before any
phase begins.

## 1. Why

Desktop kaisho 2.2 supports CalDAV locally (iCloud /
Fastmail / Nextcloud / custom self-hosted). Credentials
are stored in the OS keychain and never leave the
machine. That's a deliberate trust-model choice.

The downside surfaces in three places:

1. **PWA Calendar.** The mobile app cannot show CalDAV
   events at all — the user's phone has no access to
   the credentials sitting in their laptop's keychain.
2. **PWA / cloud advisor.** `kaisho-cloud`'s
   `/ai/advisor` only sees Google Calendar (via the
   existing Pro integration). Asking "what's next week"
   from the phone returns Google-only results; iCloud
   meetings are invisible.
3. **Hosted cron jobs.** Cloud-side cron tasks that
   want to look at calendar context (e.g. a weekly
   planner cron that should account for meetings) face
   the same blind spot.

Cloud-stored CalDAV solves all three at once.

The trade-off is a real trust escalation: the user has
to opt in to having their CalDAV password sit on our
servers (encrypted, but still). This document spells
out exactly how that's done and how reversible it stays.

## 2. Goals + non-goals

**Goals**

- Opt-in cloud storage of CalDAV account credentials,
  reusing the AES-256-GCM pattern already proven by
  `user_integrations` (migration 017).
- Server-side CalDAV fetch from the cloud — read events
  from the user's connected accounts on demand, with
  short-window caching.
- A cloud calendar aggregator endpoint
  (`/api/calendar/events`) that fans out across CalDAV
  + Google and returns the same unified shape the
  desktop aggregator already produces.
- PWA Calendar UI consuming that endpoint.
- Cloud advisor / hosted cron `list_calendar_events`
  tool wired to the aggregator, reaching feature
  parity with the desktop advisor.
- One-click desktop → cloud sync flow (push the user's
  existing CalDAV accounts up).

**Non-goals**

- **Writing to CalDAV from the cloud.** Push of clock
  entries to the user's calendar stays desktop-only in
  2.3. Cloud-side push is a 2.4+ conversation; the
  trust escalation for write access is meaningfully
  bigger than for read.
- **Removing desktop-only mode.** Cloud CalDAV is
  strictly additive. A user who never opts in keeps
  the current desktop-only behaviour.
- **Per-event sharing / collaboration.** This is about
  the user's own calendar reaching their own cloud
  surfaces, nothing more.
- **A native mobile client.** The PWA Calendar runs in
  the same web shell as the rest of the mobile app.

## 3. Threat model + trust escalation

Today the worst case for a server compromise is loss of
the data the user has explicitly chosen to sync (tasks,
clocks, customers) plus the Pro-integration OAuth
tokens already in `user_integrations`. CalDAV adds:

- Long-lived passwords (most CalDAV servers don't rotate)
- Sometimes the user's primary account password
  (iCloud app-specific passwords are scoped, but Nextcloud
  user passwords often aren't)

Controls:

- **Encryption at rest.** Same AES-256-GCM blob shape
  as `user_integrations.credentials`. Key lives in
  `CALDAV_KEY` env var on the server (separate from
  `INTEGRATION_KEY` so rotation cycles are independent).
- **RLS deny-all.** Same pattern as `user_integrations`;
  access only through the service-role-only
  `caldav_store` data-access layer.
- **No DB-side logging of the cipher.** The credentials
  column is never `SELECT`'d into logs (already enforced
  by the existing logger config; verify in phase 1).
- **Server never echoes the password back.** Even to the
  owning user. The desktop holds the canonical copy in
  the keychain; cloud holds an encrypted copy for cloud-
  side use only.
- **Per-account toggle.** The user can connect five
  CalDAV accounts on the desktop and sync only one of
  them to the cloud (e.g. work iCloud yes, personal
  Fastmail no).
- **One-click revoke.** Settings → CalDAV → "Stop cloud
  sync" wipes the cipher and the cached events from the
  cloud row; takes effect immediately.
- **Audit log.** Every cloud-side CalDAV fetch is logged
  (user_id, account_id, event count, success flag,
  source-host header) for incident response. PII-free.

## 4. Architecture overview

```
┌─────────────────────┐                 ┌──────────────────────┐
│      Desktop        │  push (opt-in)  │     kaisho-cloud     │
│  Settings > CalDAV  │ ───────────────▶│  caldav_accounts     │
│  + keychain         │                 │  + AES-GCM blob      │
│                     │                 │                      │
│  Direct CalDAV ←────┼─── still local ─┼─→  CalDAV servers    │
│  (read + push)      │                 │  (read, on-demand)   │
└─────────────────────┘                 │   ▲                  │
                                        │   │ tsdav fetcher    │
                                        │   │                  │
┌─────────────────────┐                 │   ▼                  │
│   PWA / Advisor /   │                 │  aggregator endpoint │
│   Hosted Cron       │ ◀──── events ───┤  /api/calendar/      │
│                     │                 │       events         │
└─────────────────────┘                 └──────────────────────┘
```

Two paths to the same CalDAV server:

- **Desktop path** (unchanged): reads + writes via the
  local `caldav` Python lib, credentials in keychain.
- **Cloud path** (new): reads only, via the Node
  `tsdav` lib, credentials in the cloud cipher.

Both paths normalize into the same event shape the
desktop aggregator already uses, so the PWA can render
the same `EventTile` / `WeekGrid` components.

## 5. Data model — supabase migration 021

```sql
CREATE TABLE IF NOT EXISTS caldav_accounts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL
                 REFERENCES users(id) ON DELETE CASCADE,
    -- "icloud" | "fastmail" | "nextcloud" | "custom"
    preset       TEXT NOT NULL,
    -- Resolved URL after preset templating + SSRF check.
    server_url   TEXT NOT NULL,
    username     TEXT NOT NULL,
    -- AES-256-GCM blob "iv.tag.ciphertext" (base64).
    -- Encrypted with CALDAV_KEY (separate from
    -- INTEGRATION_KEY).
    secret       TEXT NOT NULL,
    -- Human label set by the user.
    label        TEXT,
    -- Calendars the user wants surfaced (subset of the
    -- ones the server exposes). Empty array = none yet.
    enabled_calendars TEXT[] NOT NULL DEFAULT '{}',
    -- Last successful fetch, for the "degraded" badge.
    last_ok_at   TIMESTAMPTZ,
    last_error   TEXT,
    failure_count INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE caldav_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON caldav_accounts FOR ALL USING (false);

CREATE INDEX caldav_accounts_user_id_idx
  ON caldav_accounts(user_id);
```

Short-window event cache (avoid hammering iCloud on
every PWA poll):

```sql
CREATE TABLE IF NOT EXISTS caldav_event_cache (
    account_id   UUID NOT NULL
                 REFERENCES caldav_accounts(id) ON DELETE CASCADE,
    -- The (from, to) window as an ISO-day pair so the
    -- key is stable across requests.
    window_from  DATE NOT NULL,
    window_to    DATE NOT NULL,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- JSON array of normalized event dicts.
    events       JSONB NOT NULL,
    PRIMARY KEY (account_id, window_from, window_to)
);

ALTER TABLE caldav_event_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON caldav_event_cache FOR ALL USING (false);
```

TTL: 5 minutes for now; aggressive enough that a PWA
refresh feels live but light enough to not melt iCloud.
Tunable via env.

## 6. API endpoints (cloud)

All under `/api/calendar` on `kaisho-cloud`. Auth is
the standard API-key middleware.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/calendar/accounts` | List the user's cloud-synced CalDAV accounts (no secrets). |
| `POST` | `/api/calendar/accounts` | Add a CalDAV account (preset + url + username + password). Triggers a probe; rejects on auth failure. |
| `PATCH` | `/api/calendar/accounts/:id` | Update label / enabled_calendars; password change resends through probe. |
| `DELETE` | `/api/calendar/accounts/:id` | Wipe the cipher + the cache row. Idempotent. |
| `GET` | `/api/calendar/accounts/:id/calendars` | List the calendars the server exposes (so the user can pick which to surface). |
| `GET` | `/api/calendar/events?from=…&to=…` | Aggregator. Fans out across the user's CalDAV accounts + Google integration; returns the same shape the desktop tool returns. |
| `POST` | `/api/calendar/sync-from-desktop` | One-click endpoint the desktop calls to push every desktop CalDAV account up. Body: array of `{preset, url, username, password, label, enabled_calendars}`. Server probes each; returns per-account status. |

The aggregator response shape is identical to the
desktop `list_calendar_events` output so the model and
the React components are source-compatible:

```json
{
  "events": [{
    "id": "caldav:p49-icloud:...",
    "account_id": "...",
    "calendar_id": "...",
    "uid": "...",
    "title": "Standup",
    "start": "2026-06-02T09:00:00+02:00",
    "end":   "2026-06-02T09:30:00+02:00",
    "all_day": false,
    "location": null,
    "source": "caldav"
  }],
  "sources": [
    {"id": "caldav:account-a", "ok": true,  "count": 12},
    {"id": "caldav:account-b", "ok": false,
     "error": "401 unauthorized"},
    {"id": "google",           "ok": true,  "count": 5}
  ]
}
```

## 7. Server-side CalDAV fetcher

`kaisho-cloud` is Node.js. The desktop's `caldav`
Python lib does not transfer; we use **`tsdav`** (the
maintained TS/JS CalDAV client) or hand-roll the
PROPFIND / REPORT calls if `tsdav` proves too heavy.

Module layout (proposed):

```
api/caldav/
├── client.js       # tsdav wrapper, per-account memoised
├── presets.js      # mirrors desktop caldav_presets.py
│                   # (icloud / fastmail / nextcloud / custom)
├── ssrf.js         # ports the desktop SSRF guard for
│                   # custom URLs (https-only, reject
│                   # RFC1918 / loopback / link-local)
├── fetcher.js      # window-bounded event fetch +
│                   # normalisation onto the unified shape
├── cache.js        # caldav_event_cache read/write,
│                   # generation counter for invalidation
└── routes.js       # the /api/calendar/* express routes
```

Subtle issues that the desktop side has already solved
and that the cloud port must replicate:

- **iCloud per-shard hosts.** Once you authenticate
  against `caldav.icloud.com` you get redirected to
  `p49-caldav.icloud.com` (or whichever shard the
  user landed on). Subsequent requests must go to the
  shard host or you get 404s. Port the desktop's
  `_base_url_for(target_url)` helper.
- **`tzinfo`-less datetimes treated as local
  wall-clock.** Same fix as kaisho 2.1.3 (`_to_utc`).
- **RRULE expansion + EXDATE handling.** `tsdav`
  returns raw iCalendar; we need a small `ical-expand`
  pass (the desktop uses `recurring-ical-events`; the
  Node equivalent is `node-ical` or `ical-expander`).
- **DURATION without DTEND.** Same VEVENT fallback as
  desktop `_resolve_end_iso`.
- **Per-account failure threshold.** After N
  consecutive errors mark the account `degraded` so
  the PWA can show a banner.

## 8. Desktop → cloud sync flow

User journey:

1. Desktop kaisho 2.3 ships with a new Settings →
   CalDAV → "Cloud sync" section listing each
   configured account with a toggle.
2. Toggling an account on:
   - Prompts the user for explicit confirmation (a
     small dialog explaining what gets uploaded: URL,
     username, password — encrypted at rest on the
     server, can be revoked at any time).
   - POSTs the single account to
     `/api/calendar/sync-from-desktop`.
   - Stores the returned `cloud_account_id` locally so
     the desktop knows which row to update / delete.
3. Toggling an account off:
   - `DELETE /api/calendar/accounts/:id`.
   - Drops the local mapping.
4. When the desktop user changes a CalDAV password,
   the desktop offers to re-sync the changed account
   to the cloud (otherwise PWA fetches start failing).

A small `caldav_cloud` service in the desktop manages
the mapping (similar to `caldav_sync.py` for the push
side). Desktop CalDAV stays the authoritative source
of truth; cloud is a read replica that the user keeps
in sync via the toggle.

## 9. Advisor / cron integration

After the aggregator endpoint ships:

- `kaisho-cloud`'s `/ai/advisor` toolset gains a
  `list_calendar_events` tool with the same shape +
  description the desktop advisor already uses (see
  `kaisho/cron/tool_defs.py` after the
  2026-05-31 update). The hosted advisor now answers
  "what's on my calendar" correctly for any CalDAV
  user who opted into cloud sync.
- Hosted cron jobs can include calendar context in
  their prompts (e.g. a weekly planner cron that
  factors in meetings).

Until the user opts in, the cloud advisor's
`list_calendar_events` returns `{events: [], sources:
[{id: "caldav", ok: true, count: 0, note: "no cloud
CalDAV accounts -- sync from desktop in Settings"}]}`
so the model has a clear signal instead of silently
returning Google-only.

## 10. PWA Calendar UI

Consumer of `/api/calendar/events`. Mirrors the desktop
Calendar panel structure but tuned for narrow mobile:

- Default view: **day**, with horizontal swipe between
  days.
- Optional toggle to week-grid (forced into a
  scrollable horizontal pan because mobile widths
  can't fit 7 columns of 24-hour timelines).
- Event popover slides up as a bottom-sheet, not a
  side panel.
- "Book from event" action posts a clock entry via
  the existing clocks endpoint (already cloud-side).

Lives at `/calendar` in the mobile PWA router,
alongside the existing dashboard / advisor / tasks
routes.

## 11. Phasing for 2.3

Each phase is one PR on `kaisho-cloud` (some carry a
companion PR on desktop kaisho). Each ships
independently and adds value without depending on the
next.

### Phase 1 — Credential vault + manual API (no UI)

- Supabase migration 021 (`caldav_accounts`,
  `caldav_event_cache`).
- `api/caldav/store.js` data-access layer, AES-256-GCM
  with `CALDAV_KEY`.
- `POST` / `GET` / `DELETE` / `PATCH`
  `/api/calendar/accounts` endpoints (no probe yet —
  trust the user's input; phase 2 adds the live probe).
- `caldav_test_key.js` script for env smoke.
- Test plan: round-trip an account, verify decrypted
  password matches plaintext, verify DB select returns
  only ciphertext.

Risk: low. No UI consumes this yet.

Estimate: 2-3 days.

### Phase 2 — Server-side fetcher + aggregator endpoint

- `api/caldav/{client,presets,ssrf,fetcher,cache}.js`
  using `tsdav`.
- `GET /api/calendar/events?from&to`.
- Live probe in `POST /api/calendar/accounts` (reject
  on auth failure with a clear error).
- `GET /api/calendar/accounts/:id/calendars`.
- 5-min TTL on `caldav_event_cache`; invalidate on
  account update / delete.
- Per-account failure counter -> `degraded` flag.
- Test plan: integration test with a public CalDAV
  fixture; rate-limit test; iCloud shard redirect
  test (mock).

Risk: medium. CalDAV protocol quirks; iCloud
specifics. tsdav's maturity is the open question.

Estimate: 5-7 days.

### Phase 3 — Desktop → cloud sync + opt-in UI

- Desktop kaisho gains:
  - `services/caldav_cloud.py` (mapping, push, delete).
  - Settings → CalDAV → "Cloud sync" section with
    per-account toggle + explicit consent dialog.
  - i18n strings for en/de/es/ru.
- Cloud gains:
  - `POST /api/calendar/sync-from-desktop` (bulk
    upsert).
- Test plan: opt in -> verify cloud has cipher; opt
  out -> verify cipher + cache are gone; password
  rotation -> verify desktop offers to resync; cloud
  reject -> desktop surfaces the error.

Risk: medium. UX touches a sensitive boundary
(passwords leaving the local machine). Consent dialog
copy needs careful writing.

Estimate: 3-4 days (split across the two repos).

### Phase 4 — Advisor + cron integration

- `kaisho-cloud`'s `/ai/advisor` registers
  `list_calendar_events` against the aggregator with
  the same description + system-prompt rule the
  desktop advisor uses.
- Hosted cron prompts can reference calendar events
  via a small `{calendar_events}` placeholder.
- Test plan: ask the cloud advisor "what's next week"
  for a user with a cloud-synced iCloud account and
  no Google; verify CalDAV events come back.

Risk: low. Same pattern desktop has already proven.

Estimate: 1-2 days.

### Phase 5 — PWA Calendar UI

- New `/calendar` route in the mobile PWA.
- Day view + week toggle, event bottom-sheet,
  book-from-event action.
- i18n.
- Test plan: smoke each preset (iCloud, Fastmail,
  Nextcloud) on a real device.

Risk: medium. Mobile-specific UX; PWA service-worker
caching needs care so offline doesn't show stale
events as authoritative.

Estimate: 5-7 days.

### Phase 6 — Cleanup + docs

- Update `docs/architecture.md` with the cloud-CalDAV
  topology.
- User-facing docs for "What happens when I enable
  cloud CalDAV?" (trust-model copy).
- Monitoring: dashboards for fetch latency, error
  rates per preset, accounts in `degraded` state.
- Phase 5 polish loop.

Risk: low.

Estimate: 2 days.

**Total: ~3-4 weeks of focused work**, deliverable as
six PRs. Phases 1-2 unblock phase 4 (cloud advisor
parity); phase 3 unblocks user adoption; phase 5 is
the mobile-facing payoff.

## 12. NO list — out of scope for 2.3

- **Server-side CalDAV writes / push.** Pushing clock
  entries to CalDAV stays desktop-only. Cloud-side
  push needs a separate trust-escalation conversation.
- **Conflict resolution between desktop + cloud
  fetches.** Desktop reads CalDAV directly + does not
  consult the cloud cache. They are independent
  views of the same upstream.
- **Multiple users sharing a CalDAV account.** The
  account belongs to one user; no team / org
  sharing in 2.3.
- **Cross-region cloud routing.** All requests hit
  the existing single-region cloud endpoint. EU
  data-residency for CalDAV creds is a 2.4+
  conversation.
- **Native push notifications for meetings.** The PWA
  shows events but does not own the user's
  reminders. Apple Calendar / Google Calendar still
  fire those.

## 13. Open questions for the user

Decide before phase 1 starts:

1. **`CALDAV_KEY` rotation policy.** Independent from
   `INTEGRATION_KEY`, or piggyback on the same
   rotation cadence?
2. **TTL for `caldav_event_cache`.** 5 minutes is the
   proposed default. Aggressive enough?
3. **Account quota per user.** Cap at 5 cloud-synced
   CalDAV accounts? (Mirrors what's realistic — most
   users have 1-2.)
4. **What plan tier does cloud CalDAV require?**
   Companion or Pro? CalDAV is local-only and free
   on desktop; cloud sync uses server resources, so
   Pro makes sense, but framing matters.
5. **Audit-log retention.** Per-fetch log lines: how
   long do they live? Default to 30 days?

These are all reversible — the plan can start with
defaults and re-tune in phase 6.
