# KAISHO — Make-It-or-Drop-It Concept

Version: 1.0
Date: 2026-05-17
Owner: Ramon Bartl (RIDING BYTES GmbH)
Status: Decision paper. KAISHO went live ~1 month ago. No outbound
selling motion. This paper is the first real launch plan, with a
mechanical day-90 kill switch. Sister document to SENAITY's
`MAKE-OR-DROP.md` (see `~/develop/buildout/products/senaity/`).

---

## 1. Bottom line

KAISHO has been live for about one month. Zero paying customers
at one month is not evidence of anything — it is roughly the
duration of "we published a website and a few changelog posts".
The decision in this paper is therefore not "rescue a failing
product" but "do we run a real launch, or do we accept that
KAISHO is a side hobby and stop pretending it has SaaS economics".

KAISHO has two distinct shapes today, glued together unhappily:

- a **local-first open-source desktop app** (Tauri, Python
  backend, React frontend, org-mode/Markdown backends, Emacs
  integration) that does everything for free, and
- a **cloud SaaS** (`kaisho-cloud`: Supabase + Stripe + Resend +
  mobile PWA + OpenRouter AI gateway) charging €9/mo for sync and
  €19/mo for sync+AI.

These two shapes serve different tribes with opposing values. The
free shape gives away everything that defines the product; the
paid shape charges for plumbing that the loudest part of the
audience (Emacs/org-mode/self-host) does not want. The two
propositions cancel each other out — see structural risks 1 and
2 in kaisho memory note 9.

This paper sets the first real launch — 12 weeks of focused
go-to-market on a chosen tribe, chosen positioning, chosen price,
with a kill switch wired in from day one:

- **By day 90**: 10 paying customers on the SaaS, or close.
- **If not met**: `kaisho-cloud` is shut down, the desktop OSS app
  continues as a beloved tool with donations only, and founder
  attention shifts to higher-ROI work (SENAITE Analytics, customer
  projects).

The kill switch is the entire point. Without it, KAISHO drifts on
founder attention indefinitely — and `kaisho-cloud`'s operational
liability (Supabase, Stripe webhooks, password reset, JWT, mobile
PWA, AI metering) compounds whether or not anyone is paying for
it.

---

## 2. Why this is structured as a binary launch

Three facts make a hard kill switch the right structure, the same
ones that drove SENAITY's paper:

1. **Founder attention is the only scarce resource.** Ramon also
   drives SENAITE, SENAITY, healthwatch, customer projects,
   training, IAEA work. KAISHO + kaisho-cloud absorb ~1 day/week
   when actively maintained. With no selling motion attached that
   day produces nothing. With a selling motion attached, it either
   converts or it does not — and we need to know which.
2. **The market is enormous but the competitive set is brutal.**
   Time tracking and PM are commodity markets (Toggl, Clockify,
   Harvest, Linear, Notion, Things, Todoist, Trello). The
   self-hosted productivity niche has incumbents (Logseq, Obsidian,
   Anytype, Kimai, ActivityWatch). KAISHO is invisible in all of
   them. "More features" does not move the needle. "More content"
   does not move the needle. Picking a tribe and showing up where
   that tribe lives — that moves the needle.
3. **Operational liability of `kaisho-cloud` does not justify
   €9/mo conversion economics.** Even at modest success (50 paying
   subs at €9 = €450/mo) the gross margin barely covers Supabase +
   Resend + AI passthrough + the founder-hours of support, billing
   edge cases, and DPA requests. The cloud needs *either* €29+/mo
   pricing or *no SaaS at all*. The current setup is the worst of
   both.

Drift produces no information either way. The 90-day binary forces
the question to a definite answer.

---

## 3. The pivot — what changes

KAISHO has to pick one of two clean shapes. The current "free OSS
desktop + paid cloud sync" hybrid is the no-decision that
guarantees no customers and ongoing operational drag.

### 3.1 The fork — pick one

**Track A: "Consulting/Agency KAISHO" (commercial SaaS)**

Reposition KAISHO as a *daily-driver time-tracking and billing tool
for freelance consultants and small consultancies*. Sell the
SaaS. The desktop app stays as a deployment option, but the
marketing leads with the cloud product and the team/billing story.

- Kill the Emacs/CLI/org-mode surface from the marketing entirely
  (it stays in the product for users who want it, but the home
  page no longer mentions it).
- Build out the parts that consultants actually pay for:
  - real invoicing (PDF, sequential numbering, VAT, dunning)
  - accounting export (DATEV, lexoffice, Excel)
  - team seats with shared customers/contracts
  - simple client portal ("see what we billed you for")
- Price: €29/seat/mo Pro, €49/seat/mo Team (with shared workspace),
  Enterprise on request. €9 dies.

**Track B: "Power-User / Emacs KAISHO" (OSS-only)**

Accept that KAISHO is a beloved tool for org-mode/Emacs/self-host
power users. Drop the SaaS entirely.

- Open-source `kaisho-cloud` and document self-host.
- Shut down the hosted instance, Stripe, Supabase project.
- Take GitHub Sponsors / Patreon donations.
- Stop pretending it is a business; it is an excellent piece of
  open-source software with a moat of love, not a moat of revenue.

**The trap is "both".** Trying to be both is the *current* shape
and it produces zero customers. The hybrid will keep producing
zero customers no matter how long it runs, because:

- The free tier eats every reason to buy the paid one (the desktop
  app is fully featured, including AI via BYO key).
- The local-first messaging contradicts the paid cloud pitch.
- The €9 price signals "hobby" to consultants and is irrelevant to
  Emacs purists.
- The audience targeting is so broad ("freelancers + consultants +
  knowledge workers + indie hackers + developers + Emacs users")
  that every visitor reads it as "for the other group".

This paper proceeds with **Track A as the default recommendation**
because (a) it is the only one with a realistic revenue ceiling
and (b) Ramon already has the customer-style relationships
(consulting clients) to bootstrap it. Track B is the fallback and
the explicit outcome if Track A fails the day-90 test.

### 3.2 New positioning (Track A)

**Old**: "Open-source time tracking with kanban, customer
management, invoicing, and AI. Desktop app + mobile PWA with
bidirectional cloud sync."

**New**: "The end-of-day-to-invoice tool for solo consultants and
small consulting teams. Stop reconstructing your week from memory
on Sunday night. Track time as you work, on any device, and walk
into Monday with last week already invoice-ready."

Rationale:

- Removes "open-source", "kanban", "cloud sync", "AI", "Emacs"
  from the hero. None of these *sell*; they are features.
- Leads with an outcome the buyer (a billing consultant) feels in
  their body: *the Sunday-night reconstruction problem*. Every
  consultant who has ever billed by the hour knows it. That is
  the painkiller.
- Anchors the time-savings ROI: a single hour/week of recovered
  billable time at €120/hr = €480/mo. The €29/mo price becomes a
  rounding error.

Tag line candidates (pick one in week 1):

- "Bill the week you actually worked — not the one you remember."
- "From your timer to your invoice, in one tool."
- "Time tracking for consultants who hate timesheets."

The "open-source" angle moves to a *trust* footer at the bottom of
the page ("Free forever for personal use. Source on GitHub.").
Not the lead, not the headline.

### 3.3 New pricing and tiers (Track A)

**Kill** the €0 / €9 / €19 structure entirely.

**New tiers**:

| Tier         | Price          | Sold as                  | Who buys it                  |
|--------------|----------------|--------------------------|------------------------------|
| Personal     | €0             | OSS desktop, no cloud    | Power users, evaluation      |
| Pro          | €29/seat/mo    | Cloud + invoicing + mobile| Solo consultant              |
|              | or €290/yr     | (single seat)            | Saves 17% annual             |
| Team         | €49/seat/mo    | Pro + shared workspace + | Consultancies, 2–15 people   |
|              | or €490/seat/yr| client portal + roles    | Min 2 seats                  |
| Enterprise   | from €15k/yr   | Self-host + SSO + SLA    | Larger consultancies, agencies |

Reasoning:

- **€0 Personal**: Keep the OSS desktop app fully free, but
  *without* cloud sync, mobile PWA, or AI. This protects
  credibility with the OSS/Emacs crowd, but means the cloud has a
  clear reason to exist. It also makes the upsell honest: "the
  desktop is yours forever; pay only if you want devices to talk
  to each other and to invoice cleanly".
- **€29/mo Pro**: The price that signals "real business tool".
  Aligns with Toggl Plus (€18), Notion Plus (€10), Linear Standard
  (€8 — but seats add up), Things (€80 one-time). €29 sits in the
  band where a consultant pays with their business card and does
  not need approval. The yearly discount (€290 = ~17% off) drives
  cash flow.
- **€49/seat/mo Team**: Where the actual revenue comes from. Two
  partners + an assistant = €147/mo. Five-person agency = €245/mo.
  This is the tier the existing kaisho-cloud architecture *should*
  have been built for and is not yet.
- **Enterprise from €15k/yr**: Self-host + SSO + audit log + SLA.
  Sold per project. The agencies that ask "can we have this
  on-prem with our SSO" do not blink at this price.

What is *not* in the new model:

- No €9/mo. Dies entirely. Signals weakness, blocks higher pricing.
- No "Cloud Sync" tier separate from "Sync + AI". Bundle AI into
  Pro as a 100k-token-per-month quota. Above that, pay for the
  pack (€10 for another 250k). Don't put AI behind a separate
  paywall — every competitor includes it.
- No "Cloud Sync without invoicing". Invoicing is the *reason* the
  cloud exists. Bundle it.
- No 14-day trial. Use a 30-day money-back guarantee on the first
  invoice. Higher conversion (commitment first, doubt second).

### 3.4 New ICP

**Primary ICP**: EU-based independent IT/dev/design consultants
billing 60–160 hours/month at €80–180/hr, currently using a
patchwork of (Toggl OR Apple Notes OR Excel) + (Lexoffice OR
DATEV OR sevDesk) + a separate invoicing tool. Solo or 2–8
person agencies. Pain: end-of-month / end-of-week time
reconstruction; reconciling tracked hours to issued invoices;
forgetting to bill small fragments.

Why this cohort:

- Ramon *is* this customer. He knows their workflow, their tools,
  their language. The most credible pitch.
- They pay for tools out of business expenses, so €29–49/mo is a
  rounding error vs hourly rate.
- They already have RIDING BYTES adjacency through Ramon's
  consulting network — a warm-book entry point.
- The Sunday-night-reconstruction problem is universal in this
  cohort. No need to invent a pain.

**Secondary ICP**: 5–15-person consultancies in the same niches,
because Team-tier ARR per customer is far higher (€245–735/mo).
Sales cycle longer; close one of these and the day-90 metric
becomes easy.

**Out-of-scope for the 90 days**: lawyers and accountants (heavy
compliance, separate sales motion), enterprise (sales cycle too
long), US market (Stripe simpler in EU, lexoffice/DATEV
integrations are EU-specific), non-billing knowledge workers
(salaried product designers etc — no buying pressure).

### 3.5 New marketing claim, in one paragraph

> KAISHO is the time-tracking and invoicing tool for solo
> consultants and small consultancies who hate timesheets. Track
> as you work — desktop, mobile, or just the menu bar — and end
> each week with last week's hours already invoice-ready, exported
> to lexoffice or DATEV in one click. €29 per seat per month.
> Free desktop-only version on GitHub.

The lexoffice/DATEV mention is deliberate: it is what makes the
pitch immediately credible to a German freelancer and removes the
"yeah but what about my accountant" objection.

---

## 4. The 90-day plan (Track A)

### Week 1 — Sign-off and the fork

- [ ] Ramon signs this paper. Picks Track A or Track B. (Track A
      assumed for this plan.)
- [ ] Pick final tag line from §3.2.
- [ ] Internal communication: no further KAISHO commits for 90
      days unless directly tied to closing a named customer or
      the work explicitly listed in §7.
- [ ] Pull personal contact list: the 20 freelance/consulting
      contacts most likely to try it. Mark the 10 warmest for the
      pilot round.
- [ ] Decision: keep the YouTube video series concept? Re-aim for
      Track A (1 video on "the Sunday-night problem" rather than
      "a six-part personal story arc"). Or shelve.
- [ ] Open the kill-or-pivot tracking doc with the four metrics
      from §8.

### Weeks 2–4 — Build the missing commercial parts

This is the *only* engineering allowed during the 90 days. It
is real work but it is finite. If any item is bigger than its
estimate, scope down rather than slip — better a shipped MVP
than a perfect feature on day 91.

- [ ] **Invoice generation** (~5 days):
  - Sequential per-tenant numbering
  - PDF layout (one default template, tenant branding overlay)
  - VAT handling (DE 19% / 7% / reverse charge intra-EU)
  - Sequential numbering survives deletes (gap-free)
- [ ] **lexoffice export** (~3 days):
  - CSV in lexoffice voucher-import format
  - One-click "mark invoiced and export" workflow
- [ ] **DATEV export** (~3 days):
  - CSV in DATEV format (vouchers + line items)
- [ ] **Team workspace** (~5 days):
  - Multi-seat tenant in Supabase schema
  - Shared customers/contracts within tenant
  - Owner / admin / member roles
  - Per-seat billing in Stripe
- [ ] **Pricing-page rebuild + Stripe products** (~2 days):
  - Personal / Pro / Team / Enterprise as in §3.3
  - Remove the €9/€19 products from Stripe (after migrating any
    existing user — there are none)
- [ ] **Landing page rewrite** (~2 days):
  - New hero, sub-hero, three feature blocks (Track, Invoice,
    Sync), proof block, FAQ, pricing
  - Move "Open source", "Emacs", "CLI", "Org-mode" to a single
    section near the bottom titled "For developers"

### Weeks 5–7 — Convert the warm book

- [ ] Personal email to each of the 10 warmest consulting
      contacts. Offer: 6 months free Pro for honest feedback +
      written permission to use them as a logo on the site. No
      "case study" pressure yet — just usage.
- [ ] For every accept: 30-minute onboarding call. Walk them
      through setup. Watch where they get stuck. Fix it.
- [ ] For every decline: ask the one question — "what would have
      to be true for you to pay €29/mo for this?". Log answers.
- [ ] Target by end of week 7: 6 active pilot users, 4 of whom
      have issued at least one real invoice through KAISHO.
- [ ] First weekly "office hours" call: 30 minutes, public link,
      anyone can join, open Q&A on KAISHO and time tracking in
      general. Builds the founder-led-sales muscle.

### Weeks 8–10 — Open public launch

- [ ] **Show HN launch**: title aimed at the consulting pain, not
      the tech stack. Example: "KAISHO — your week, already
      invoice-ready (open source for personal use)". Time it for
      Tuesday 13:00 UTC. Ramon stays on the thread for 12 hours
      to answer.
- [ ] **Product Hunt launch**: schedule for the Thursday of the
      same week. Cross-pollinate with HN momentum. Get the 10
      pilot users + 20 friendly contacts queued to upvote at
      launch.
- [ ] **Reddit posts**, one per week, *not* coordinated:
  - r/freelance: "How I stopped reconstructing my week on
    Sunday" — story format, link in comments
  - r/selfhosted: focus on the OSS desktop, the cloud as
    optional
  - r/orgmode: focus on the org-mode backend, do not push the
    SaaS at all (community is hostile to it)
- [ ] **awesome-selfhosted PR**: add KAISHO under productivity/
      time-tracking. Long-tail SEO and credibility.
- [ ] **One sponsored video** with a known org-mode YouTuber
      (Protesilaos or System Crafters). Budget: €500–1500. Brief:
      focus on the desktop OSS app and the org-mode backend; the
      SaaS is mentioned but not pushed.
- [ ] **Stop the existing "influencer scout" plan**. The May
      2026 list (@ProductivityPro, @TaskMaster etc.) is
      AI-fabricated and would burn €3–6k for negligible signal.

### Weeks 11–12 — Close, document, decide

- [ ] Convert pilot users with active invoice usage into paid
      subscriptions at end of free period (offer 50% off year 1
      as thanks).
- [ ] Land first Team-tier customer (2+ seats). One paid Team
      customer = 2× a Pro customer in MRR and the proof point
      that the segment exists.
- [ ] Hold day-90 review (§8). Mechanical decision.

---

## 5. Who does what

For 90 days KAISHO runs on a two-person model, same as SENAITY.

### 5.1 Ramon — founder, salesperson, onboarder

- Owns every pilot relationship personally.
- Personally writes every outbound email.
- Hosts weekly office hours (30 min).
- Owns the HN/Product Hunt launches.
- Time budget: 1 day/week (Wednesday) for 12 weeks = 12 days.
- Hard rule: no KAISHO commits except the items in §4 weeks 2–4
  and bugs found by paying users.

### 5.2 Engineering (Coder agents + Ramon's review)

- Build the §4 weeks 2–4 features. Nothing else.
- Maintain the cloud production stack (Supabase, Stripe,
  deployment). Reactive only.
- Everything in `kaisho/` CHANGELOG (kaisho-mode, calendar feed,
  KB improvements, 32 AI tools etc.) is frozen for 90 days unless
  it unblocks a pilot user.

### 5.3 No influencers, no agency, no new hires

- The May 2026 "influencer scout" with fabricated handles is
  scrapped.
- The one sponsored video with a *real* org-mode YouTuber in
  §4 weeks 8–10 is the only paid marketing.
- No marketing agency, no contractor, no SEO consultant.

---

## 6. What we keep, de-emphasize, sunset, drop

### Keep and lead with

- Time tracking (desktop + mobile + menu bar)
- Customer + contract + budget management
- Invoicing with PDF + sequential numbering + VAT (NEW)
- lexoffice + DATEV export (NEW)
- Team workspaces + per-seat billing (NEW)
- Cloud sync (now bundled into Pro, not a separate SKU)

### Keep but de-emphasize (in product, not in marketing)

- Kanban board (becomes a feature, not the headline)
- AI advisor (bundled into Pro as a token quota)
- Notes + KB
- GitHub integration
- Mobile PWA (becomes "available with Pro" instead of headline)
- CLI (`kai`), Emacs mode, org-mode backend
- Multi-profile, cron jobs, advisor-tool system

### Sunset on day 30 (if Track A)

- Standalone €9/mo Cloud Sync SKU in Stripe (after migrating any
  existing user — there should be none)
- Standalone €19/mo Sync+AI SKU
- The free-tier-with-cloud-sync illusion (cloud sync becomes
  Pro-only)

### Drop entirely

- Marketing language targeting "freelancers + consultants +
  knowledge workers + indie hackers + developers + Emacs users"
  simultaneously. Pick one (consultants).
- The synthetic "influencer scout" list.
- "Local-first" as a hero claim. It is still true (the desktop is
  local-first) but it is not the *pitch*; it is a footer point for
  the OSS section.

---

## 7. What from existing roadmaps survives the freeze

Both `kaisho` and `kaisho-cloud` have ongoing engineering momentum
(CHANGELOG entries, planned features). For the next 90 days the
only items that get touched are the ones that close a paying
customer or cut support cost.

### Survives — required to ship Track A

| Where         | Item                                          | Why it survives          |
|---------------|-----------------------------------------------|--------------------------|
| kaisho-cloud  | Invoicing service + PDF generation            | Required for §3.2 pitch  |
| kaisho-cloud  | lexoffice + DATEV CSV export                  | Required for §3.4 ICP    |
| kaisho-cloud  | Multi-seat Supabase schema + role checks      | Required for Team tier   |
| kaisho-cloud  | Stripe per-seat billing                       | Required for Team tier   |
| kaisho-cloud  | Pricing-page rebuild + Stripe product reset   | Required for §3.3 pricing|
| kaisho        | Invoicing UI in desktop (read from cloud)     | Pilot users need it      |
| kaisho        | Team-workspace switcher in desktop UI         | Pilot users need it      |
| website       | Landing/positioning rewrite                   | Required for §3.2/3.5    |

### Explicitly paused for 90 days

- New `kaisho-mode` features
- New AI advisor tools beyond the 32 already shipped
- New cron-job templates
- KB improvements
- Mobile PWA feature parity beyond what already exists
- Tauri desktop auto-updater improvements
- Org-mode backend extensions
- Markdown backend extensions
- New i18n languages beyond what already ships
- Performance / refactor work that does not block a pilot

### One exception: any pilot user blocker

If a pilot user in weeks 5–10 hits a real blocker (data loss,
billing bug, cannot complete an invoice), it gets fixed
immediately. The freeze is about feature work, not about ignoring
the people we are trying to convert.

---

## 8. Day-90 decision — the four metrics

Same structure as SENAITY's paper. Mechanical, not emotional.

| Metric                                     | Make-it threshold | Drop-it threshold |
|--------------------------------------------|-------------------|-------------------|
| Paying customers (signed/billing)          | ≥ 10              | < 5               |
| Annual recurring revenue committed         | ≥ €5,000          | < €2,500          |
| At least one Team-tier customer (2+ seats) | yes               | no                |
| Active pilot conversion rate (pilots→paid) | ≥ 40%             | < 20%             |

Outcome rules:

- **All four "make" thresholds met** → continue. Move to a
  v2 plan that invests in: lexoffice OAuth integration, automated
  recurring billing, accountant-facing exports, EU-market SEO
  content, paid acquisition experiments. Hire (or contract) a
  part-time growth marketer.
- **All four "drop" thresholds met** → switch to Track B on day 91.
  Open-source `kaisho-cloud`, shut down hosted instance, cancel
  Stripe products, archive Supabase project, redirect kaisho.dev
  to a GitHub-Sponsors-style donation page. The desktop OSS app
  continues; it just stops pretending to be a business.
- **Mixed (e.g. 6 customers, €3k ARR, no Team customer, 30%
  conversion)** → 30-day extension on a single named hypothesis,
  most likely "we need one Team-tier customer to prove the
  cohort exists". Maximum one extension. If day-120 numbers do
  not cross the "make" thresholds, switch to Track B.

ARR thresholds are deliberately modest. KAISHO at €5k ARR after
90 days is not a "good business" — it is a "we have proven a
market exists and the unit economics work, now we can invest".
That is the question this paper is built to answer.

---

## 9. If KAISHO makes it — what comes next

- **Lexoffice OAuth** (real integration, not CSV) within 6 months.
  This is the moat-builder for the German market.
- **Accountant view**: a separate login for the customer's
  bookkeeper, read-only on invoices, comments back to the
  consultant. Becomes the Team-tier killer feature.
- **Content engine**: 1 blog post / week on "the consulting
  business" (pricing, contracts, tax). Long-tail SEO.
- **Recurring contracts / retainers** as a first-class entity.
  Most consultants have both project hours and monthly retainers
  and currently bolt them together.
- **EU-market launch beyond DE**: NL, AT, CH, FR localization of
  the invoicing layer.

None of this starts until day 91 with the day-90 metrics met.

---

## 10. If KAISHO drops — what we keep

A "drop" verdict is not a write-off:

- The desktop OSS app remains, free forever, with all current
  features. It is genuinely loved by its small user base.
- `kaisho-cloud` becomes open source so the few users who want
  self-hosted sync can run it.
- The Supabase / Stripe / Resend infrastructure is decommissioned.
  Operational liability ends.
- The CHANGELOG continues. KAISHO becomes the "well-loved tool"
  with no commercial pressure.
- The lessons (positioning rewrite, ICP narrowing, founder-led
  sales playbook, four-metric kill switch) become reusable for
  the next product attempt.
- Ramon recovers ~1 day/week of attention. That day goes into
  SENAITY's parallel make-or-drop, into SENAITE Analytics, or
  into paying customer work — wherever the higher ROI is at
  that point.

---

## 11. Sign-off

| Role     | Name        | Date        | Decision        |
|----------|-------------|-------------|-----------------|
| Founder  | Ramon Bartl |             | Track A / Track B / Defer |

On Track A approval, week 1 starts the following Monday. Day-30
checkpoint: §4 weeks 2–4 features shipped. Day-60 checkpoint:
warm-book conversion results. Day-90 review: §8 metrics, binary
decision.

On Track B approval, week 1 starts the wind-down: announce on
the website, migrate any paying user (there are none), shut down
Stripe and Supabase, archive `kaisho-cloud` as open source,
publish the donation page. Track B wind-down is one week of work.

---

## 12. Cross-link with SENAITY's paper

This paper and SENAITY's `MAKE-OR-DROP.md` run in parallel for the
same 90 days. The two products share:

- the same founder attention budget (Ramon does both, ~3
  days/week total: 2 days SENAITY, 1 day KAISHO)
- the same structural critique (engineering-led, distribution-
  absent, dead-zone pricing, fuzzy ICP, free tier that competes
  with paid, no reference customers)
- the same four-metric kill switch with thresholds tuned per
  product
- the same fundamental experiment: *can RIDING BYTES learn to
  sell a SaaS, on either of these products?* If neither product
  makes it, the answer is "no, not yet" and the next move is to
  acquire that capability (a co-founder, an experienced growth
  hire, or a different product shape entirely) before launching
  anything new.
