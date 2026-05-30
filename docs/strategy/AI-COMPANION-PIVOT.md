# KAISHO — AI Companion Pivot (Track AI)

Version: 1.0
Date: 2026-05-17
Owner: Ramon Bartl (RIDING BYTES GmbH)
Status: Sister document to `MAKE-OR-DROP.md`. Proposes a third
track ("Track AI") that re-positions KAISHO around what it has
organically become: a local-first AI work companion with
scheduled agents and an MCP server. Recommended over Track A
(consulting/agency SaaS) given product reality, founder fit, and
market timing.

---

## 1. The observation

KAISHO's marketing positions it as "time tracking + kanban +
invoicing for freelancers". Its *product* tells a different story.

What KAISHO actually contains in May 2026:

- 32 AI advisor tools (action-capable, not just chat)
- Cron-orchestrated AI jobs (morning briefing, project reports,
  business scouting)
- Multiple AI provider support (Ollama, LM Studio, Claude API,
  OpenRouter, OpenAI)
- Knowledge base + notes + tasks + time + customers as one
  unified data substrate
- An MCP server exposing all of this to any MCP-aware client
  (Claude Code, Cursor, Claude Desktop, ChatGPT, custom agents)
- Plain-text storage (org-mode and Markdown) — user-owned data
- Local-first by default; cloud + AI gateway optional

The invoicing + kanban marketing description fits less than half
of the box. KAISHO is closer to **a local-first personal AI agent
platform that happens to track time** than to a time-tracking app
that has added AI features.

Lived evidence: in a single recent session, the founder used
KAISHO to run a multi-hour business-scout investigation across
many products and notes, with the AI saving structured findings
and able to resume work next week. That is not Toggl with a
chatbot. That is something else.

This paper takes that "something else" seriously.

---

## 2. What is genuinely novel here, and what isn't

The relevant competitive set is no longer Toggl, Clockify,
Harvest. It is:

- **Granola.ai** — meeting AI, no agent layer, ~$19/mo, funded
- **Reflect** — AI-augmented note-taking, $10–18/mo
- **Mem.ai** — AI knowledge base, $15/mo
- **Saner.ai** — productivity + AI, $20/mo
- **Khoj.dev** — open-source personal AI over your data
- **AnythingLLM / LibreChat** — self-hosted AI chat over docs
- **Notion AI / Obsidian + Smart Connections** — bolted-on AI

What none of these have together:

1. **Action-capable agents over a personal data substrate.**
   Most AI memory tools only retrieve. KAISHO can *act* — book
   time, run cron, create tasks, write notes, search KB, hit
   GitHub, send email.
2. **Cron-orchestrated proactive AI.** "Every Monday at 7am,
   scan my customers and surface who needs follow-up." Almost no
   tool ships scheduled AI as a first-class concept. Genuinely
   novel and demoable.
3. **MCP server out of the box.** Claude Code, Cursor, ChatGPT,
   any MCP client can use KAISHO as their long-term memory and
   tool layer without leaving their existing workflow. This is
   the viral hook nobody else has.
4. **Local-first with cloud as option, not the inverse.** Most
   AI memory tools are cloud-only. KAISHO runs fully offline with
   Ollama. Privacy-conscious AI builders care about this; the
   self-hosted crowd was waiting for exactly this product.

What is *not* novel:
- "AI chat over my notes" (commodity in 2026)
- "Natural-language time booking" (every tool ships this)
- "Weekly summaries" (commodity)

The pitch must lead with (1), (2), (3), (4) — not with chat or
summaries.

---

## 3. The narrower-market concern, quantified

The honest concern: this audience is smaller than freelance
consultants. True. Sized roughly:

| Audience                                          | Size globally | Reachable in 90 days |
|---------------------------------------------------|---------------|----------------------|
| All freelancers (Track A consulting ICP)          | ~80M          | tens of thousands    |
| Paid Claude/Cursor/ChatGPT users                  | ~25M          | hundreds of thousands|
| AI power-users building agents/MCP                | ~500k–1M      | tens of thousands    |
| MCP-aware users wanting a memory layer            | ~50k–200k     | low thousands        |
| Local-first + AI builder + willing to pay €30+/mo | ~10k–30k      | high hundreds        |

That bottom band is small. But three offsetting facts:

1. **Price tolerance is 2–3× higher.** This audience pays $20/mo
   for ChatGPT, $20/mo for Claude, $20/mo for Cursor, often
   $200/mo on API tokens. €29–59/mo for "AI's long-term memory"
   is not the friction it is for a Toggl user.
2. **Distribution is online-native.** This audience lives on X,
   Hacker News, Product Hunt, Discord, MCP-server registries.
   Cold outreach is replaced by content + launches. Feedback in
   1–2 weeks instead of 2–3 months.
3. **MCP is a viral hook.** Every Claude Code / Cursor user is a
   potential KAISHO user *without changing their workflow*. They
   plug KAISHO in, KAISHO becomes their memory layer. That
   acquisition mechanism does not exist for the consulting pitch.

Conservative revenue math: 300 paying customers at €39/mo blended
≈ €140k/yr ARR within 12 months of a real launch. Compare to
Track A's realistic ceiling (~10 consulting customers in 90 days
at €29 = €3.5k ARR; long-term maybe €30–80k ARR if it works).

---

## 4. Track AI vs Track A — head-to-head

| Dimension                       | Track A (Consulting)          | Track AI (Companion)          |
|---------------------------------|-------------------------------|-------------------------------|
| TAM                             | Huge but indifferent          | Small but actively buying     |
| Price tolerance                 | €19–49/mo                     | €29–99/mo (incl. tokens)      |
| Competition                     | Brutal (Toggl, Clockify…)     | Crowded, pre-consolidation    |
| Distribution channel            | Cold outreach, slow           | HN/X/PH launches, viral       |
| Founder alignment               | Medium (Ramon bills, yes)     | High (Ramon uses it this way) |
| Engineering already done        | 60% (invoicing missing)       | 90% (it is already this)      |
| Differentiation                 | Hard (commodity)              | Easier (local-first + MCP)    |
| Risk: frontier AI obsoletes you | Low                           | Medium-high                   |
| Risk: market does not exist     | Low (consultants pay)         | Medium (early signal only)    |
| Time to first signal            | 6–8 weeks                     | 1–2 weeks                     |
| Operational complexity          | Higher (invoicing, VAT)       | Lower (build on existing)     |

**Track AI is more aligned with what KAISHO actually is, requires
less new engineering, has faster feedback, and a higher revenue
ceiling — but carries a real technology risk that a frontier-AI
release could subsume part of the value.**

The technology-risk mitigation is positioning: the moat is not
"we do AI memory", the moat is **local-first + action-capable +
scheduled AI + MCP server + user owns the data**. Frontier models
do not naturally own that combination.

---

## 5. The repositioning

### 5.1 New positioning

**Old**: "Open-source time tracking with kanban, customer
management, invoicing, and AI."

**New**: "KAISHO is the local-first AI work companion. It knows
your tasks, your customers, your time, your notes, and your code
— and runs your AI agents over them on schedule, with the model
and API key of your choice. Use it from your desktop, your phone,
or plug it into Claude Code, Cursor, or ChatGPT via MCP. Your
data stays on your machine."

Tag-line candidates (pick one in week 1):
- "Your AI's long-term memory. Local-first."
- "The AI companion that runs on your schedule, on your hardware."
- "Give Claude (or any AI) a memory, a calendar, and a to-do list."

The time-tracking + invoicing surface stays in the product. It
becomes "what your AI companion can already do" rather than "what
the product is".

### 5.2 New pricing and tiers (Track AI)

| Tier         | Price          | What you get                    | Who buys it                  |
|--------------|----------------|---------------------------------|------------------------------|
| Hobby        | €0             | OSS desktop, BYO API key, no    | Builders, evaluation         |
|              |                | cloud, no mobile                |                              |
| Companion    | €29/mo         | 500k tokens of frontier model + | Solo AI power user           |
|              | or €290/yr     | cloud sync + mobile PWA + cron  |                              |
|              |                | AI + MCP gateway                |                              |
| Pro          | €59/mo         | 2M tokens + premium MCP         | Indie hacker, heavy user     |
|              | or €590/yr     | integrations (Linear, GitHub    |                              |
|              |                | Projects, Calendar, Slack)      |                              |
| Team         | €99/seat/mo    | Pro + shared KB + team agents + | Small co / agency, min 2     |
|              |                | audit log + role-based access   |                              |

Pricing rationale:
- **Token quotas are the gross-margin lever.** Included quota
  removes BYO-key friction (the #1 conversion blocker for
  technical users), but not so generous heavy users avoid
  upgrading. Overage packs (e.g. €15 for another 500k tokens)
  keep the model elastic.
- **€29/mo Companion** sits in the AI-tool band where the buyer
  pays with a personal card and does not need approval. Aligned
  with Claude/ChatGPT/Cursor mental anchor.
- **€59/mo Pro** anchors with Cursor Business, Granola Pro,
  Notion AI bundle. Signals "this is a real tool".
- **€99/seat Team** is where team-AI revenue happens. The first
  Team customer is the proof point that the cohort exists at
  all.

What goes away:
- €9/mo Cloud Sync standalone (existing). Either OSS desktop
  with BYO, or paid with everything bundled.
- €19/mo Sync + AI standalone (existing). Same reason.
- "Bring your own model" as a paywall — encourage it on Hobby,
  but provide a frictionless quota on paid tiers.

### 5.3 New ICP

**Primary ICP**: AI-power-users / indie builders who:
- Already pay for Claude, ChatGPT, or Cursor
- Use MCP servers (or have heard of them and want to)
- Run a personal note system (Obsidian, Logseq, org-mode,
  Markdown files)
- Care about local-first / data ownership
- 1–10-person operations (solo or small builder team)
- EU, UK, US, AU — anywhere with English/German support

Why this cohort:
- Ramon is this customer. He uses KAISHO as an AI companion now.
  Most credible pitch.
- They pay for AI tools as a category — €29–59/mo is a
  rounding error vs their existing AI bill.
- They are online and reachable via HN, X, Product Hunt, Discord
  — no cold outreach needed.
- They share tools. One satisfied builder = 5 trial signups.

**Secondary ICP**: small AI-curious teams (2–10 people) at
software shops, design agencies, indie game studios. The Team
tier targets them; revenue per customer is much higher.

**Out-of-scope for the 90 days**: enterprise (sales cycle),
non-technical users (KAISHO assumes some setup comfort),
casual ChatGPT-only users (do not value local-first).

---

## 6. Distribution (Track AI)

This is the largest difference from Track A and the reason Track
AI is structurally cheaper to test.

- **Show HN as the launch event** (week 5–6, not as a
  milestone three months in). Title: "KAISHO — local-first AI
  work companion with scheduled agents and MCP server". Demo
  video: a cron-AI doing a real task + a Claude Code MCP
  integration in 60 seconds. AI-tools launches on HN have done
  very well through 2025–2026.
- **AI-builder X / Twitter**: A 30-second video per week showing
  KAISHO doing something. The business-scout session is literally
  a tweet. Reply to "ChatGPT keeps forgetting" complaints with
  "we built a thing for this — local, your data".
- **MCP + Claude Code content**: Anthropic actively promotes MCP
  integrations. Write the canonical "use KAISHO as your Claude
  Code memory layer" post. Get listed in
  github.com/modelcontextprotocol/servers and the curated MCP
  registries.
- **Direct demo trading in Cursor / Granola / Reflect Discords**.
  Be visible without spamming. Comment with substance, link only
  when asked.
- **Weekly "what my AI did this week" newsletter** by the
  founder, with real cron-AI outputs. Eat your own dog food
  publicly. Builds founder-as-personality + demo content
  pipeline at the same time.
- **Product Hunt launch** scheduled for an AI-tools-themed day,
  cross-pollinated with HN momentum.
- **One sponsored video** with a relevant creator (Matthew
  Berman, Cole Medin, Wes Roth, AI Jason, Patrick Roberts —
  AI-tooling YouTubers, not the AI-fabricated influencer-scout
  list). Budget €1k–2k. Brief: focus on the cron-AI and MCP
  angles.

This kind of distribution is fast, near-free, and plays to
KAISHO's strengths. It also produces a clear signal in 2–3 weeks
on whether the market exists — much faster than B2B cold outreach.

---

## 7. The 90-day plan (Track AI)

### Week 1 — Sign-off, naming, positioning

- [ ] Ramon picks Track AI over Track A (and over Track B).
- [ ] Pick final tag line from §5.1.
- [ ] Rewrite kaisho.dev landing copy around the new positioning
      (eat into the existing site — no new domain).
- [ ] Decide on the AI-companion product naming. Options:
      "KAISHO" stays as the umbrella; "KAISHO Companion" or
      "KAISHO AI" as the paid tier name; or drop sub-naming
      entirely and let the tier name (Companion / Pro / Team)
      carry the meaning.
- [ ] Open the kill-or-pivot tracking doc with the four metrics
      from §9.

### Weeks 2–3 — Ship what is missing for the launch

The product is 90% there. Three things are missing for a
credible launch:

- [ ] **Stripe products and pricing-page rebuild** (~2 days)
  - Hobby / Companion / Pro / Team as in §5.2
  - Remove the existing €9 and €19 SKUs after migrating any
    user (there should be none)
- [ ] **MCP server hardening + documentation** (~3 days)
  - Confirm the existing MCP server exposes the tools cleanly
  - Write the "use KAISHO with Claude Code" install guide
  - Write the "use KAISHO with Cursor" install guide
  - Write the "use KAISHO with Claude Desktop" install guide
  - Submit PRs to the major MCP server registries
- [ ] **Token-quota metering for paid tiers** (~3 days)
  - Per-tenant counter on the OpenRouter gateway (already exists
    — confirm)
  - Soft-cap UX in the desktop app + mobile PWA
  - Overage-pack purchase flow in Stripe
- [ ] **One demo cron-AI job that "wows"** (~2 days)
  - "Weekly business pulse": every Monday at 7am, the AI
    reviews last week's clocks, tasks, customer touchpoints, KB
    additions, and produces a one-page briefing. Pre-configured
    template included on first install.
  - This is the screenshot for the landing page, the demo for
    the HN post, the proof of "scheduled agents" as a category.

### Weeks 4–5 — Soft launch + content engine

- [ ] Publish 3 short videos to X showing real cron-AI runs.
- [ ] Publish the canonical "KAISHO as your Claude Code memory
      layer" blog post on ridingbytes.com / dev.to.
- [ ] Open weekly office hours (30 min, public link) — for
      AI-builder users, not for SENAITE customers. Different
      audience, different call.
- [ ] Soft-share with 10 named contacts in the AI-builder
      network. Goal: 5 active testers by end of week 5.

### Weeks 6–7 — Show HN + Product Hunt

- [ ] Show HN launch on a Tuesday at 13:00 UTC. Title aimed at
      the value, not the tech. Ramon stays on the thread for 12
      hours.
- [ ] Product Hunt launch on the Thursday of the same week.
      Queue the 10 named contacts + 20 friendly to upvote at
      launch.
- [ ] Reach out to 3 AI-tooling YouTubers for the sponsored
      video (Matthew Berman, Cole Medin, or similar). Goal: 1
      booked for week 10–11.
- [ ] Submit to awesome-mcp-servers, awesome-selfhosted,
      awesome-AI-agents, and any other relevant curated list.

### Weeks 8–10 — Convert, support, learn

- [ ] Convert HN/PH traffic into trials, trials into paid.
- [ ] Hands-on support for the first 20 paid users — Ramon
      personally on Slack/Discord. Every conversation captured;
      pain points feed back into the product backlog
      (post-day-90).
- [ ] Land the first Team-tier customer. Even one team account
      proves the cohort exists.
- [ ] Sponsored video ships (recorded week 9, live week 10).

### Weeks 11–12 — Close, document, decide

- [ ] Run a second content push: "what we learned in 10 weeks
      of launching an AI companion" post on HN/X.
- [ ] Hold the day-90 review (§9). Mechanical decision.

---

## 8. What from existing engineering survives the freeze

Same principle as the other papers: only what unblocks a paying
customer or a launch.

### Survives — required to ship Track AI

| Where         | Item                                       | Why                              |
|---------------|--------------------------------------------|----------------------------------|
| kaisho-cloud  | Stripe Companion/Pro/Team SKUs + pricing   | Required for §5.2                |
| kaisho-cloud  | Token quota metering + overage purchase    | Required for §5.2 economics      |
| kaisho        | MCP server polish + 3 client install docs  | Required for §6 distribution     |
| kaisho        | "Weekly business pulse" cron template      | Required for §7 wk2–3 demo       |
| website       | Landing rewrite around §5.1                | Required for §7 wk2–3            |
| kaisho-cloud  | Onboarding email sequence for paid trial   | Required for conversion          |

### Explicitly paused for 90 days

- New 33rd/34th AI advisor tool (32 is enough; depth > breadth)
- New kaisho-mode features
- New cron-job templates beyond the one demo template above
- Additional storage backends
- Tauri desktop performance refactoring
- Org-mode backend extensions
- Markdown backend extensions
- New i18n languages
- Invoicing improvements (Track A territory — only revive if
  Track AI hits day-90 metrics and team-tier customers ask)

---

## 9. Day-90 decision — the four metrics (Track AI)

Different shape from Track A: more customers, lower ARR per
customer, GitHub stars as a proxy for the OSS/builder audience,
MCP usage as the proxy for "are we the memory layer?".

| Metric                                          | Make-it    | Drop-it    |
|-------------------------------------------------|------------|------------|
| Paying customers                                | ≥ 20       | < 10       |
| MRR (paying, blended)                           | ≥ €700     | < €400     |
| GitHub stars net-new from launch                | ≥ 300      | < 100      |
| Active MCP integrations (users with KAISHO      | ≥ 10       | < 3        |
| MCP-connected to another tool e.g. Claude Code) |            |            |

Outcome rules:

- **All four "make" thresholds met** → continue. Invest in:
  more MCP integrations, lexoffice OAuth (if Team customers ask
  for it), more cron templates, a Claude Code skill / Cursor
  rule pack that ships alongside KAISHO. Consider a part-time
  growth contractor for content.
- **All four "drop" thresholds met** → fall back to Track B
  on day 91. Open-source `kaisho-cloud`, shut down the hosted
  instance, archive Stripe products, redirect kaisho.dev to a
  donation page. The desktop OSS app continues; the SaaS
  experiment ends.
- **Mixed (e.g. 15 customers, €500 MRR, 200 stars, 4 MCP
  integrations)** → 30-day extension on a single named
  hypothesis. Maximum one extension. If day-120 numbers do not
  cross the "make" thresholds, fall back to Track B.

---

## 10. Risks specific to Track AI

Three risks that Track A does not carry, all worth naming up
front:

### 10.1 Frontier models adding native memory + MCP

Anthropic, OpenAI, and Google are all moving toward longer
memory and richer tool use. Probability that one of them ships
"first-party long-term memory with MCP-equivalent action layer"
in the next 12 months: medium-high.

Mitigation: the moat is not "we do AI memory". The moat is
**local-first + scheduled (cron) AI + plain-text data + user-
owned + works with multiple model providers + MCP server**. A
frontier-model native feature will be cloud-only, single-provider,
and chat-shaped. KAISHO's value proposition stays distinct.

### 10.2 MCP spec evolution

MCP is fast-moving in 2026. Spec changes mean recurring
maintenance work to keep the server compatible with current
clients (Claude Code, Cursor, Claude Desktop).

Mitigation: small ongoing tax; accept it as part of the
operational cost of being in this market. Probably <1 day/month.

### 10.3 OpenRouter / model-provider pricing volatility

Token costs can change overnight. A 2× price hike on the
cheapest frontier model erodes the gross margin on the included
quota.

Mitigation: build the overage pricing so the gross margin
survives a 2× cost increase. Re-price quotas every 6 months in
line with reality. Communicate clearly to paying users.

### 10.4 Audience saturation

Every new AI productivity tool in 2026 fights for the same
limited attention. Many will fail. Being the local-first MCP
option is a positioning advantage, but only if executed before
the market consolidates.

Mitigation: launch fast (8 weeks), be loud (weekly content),
build a real community (Discord). The window is wider in 2026
than it will be in 2027.

---

## 11. Recommendation

**Take Track AI.** Three reasons summarised:

1. **It matches reality.** KAISHO is already this product. Track
   A asks to build invoicing/lexoffice/DATEV/team workspaces over
   3 weeks. Track AI asks to reposition and launch what already
   exists.
2. **It matches the founder.** Ramon uses KAISHO as an AI
   companion now, not as a time tracker. The product the founder
   uses is the product the founder sells well.
3. **It matches the market window.** 2026 is the year MCP and AI
   memory become mainstream. Being the local-first option in
   that landing zone is a real position. The window closes when
   frontier providers ship native equivalents — 12–18 months
   out. Now is the right time.

The narrower-market concern is real but mis-weighted. A *smaller*
audience that *actively buys* AI tools beats a *larger* audience
that resists buying. The consulting market is larger but cold;
the AI-builder market is closer to its money.

---

## 12. Relationship to the other KAISHO papers

This paper proposes Track AI as a third option alongside the two
already named in `MAKE-OR-DROP.md`:

| Track    | Shape                                    | Status                       |
|----------|------------------------------------------|------------------------------|
| Track A  | Commercial consulting/agency SaaS        | Documented in MAKE-OR-DROP.md |
| Track B  | OSS-only with donations                  | Documented in MAKE-OR-DROP.md |
| Track AI | Local-first AI work companion (this doc) | Documented in THIS doc       |

The week-1 sign-off in `MAKE-OR-DROP.md` should now read
"pick Track A, Track AI, or Track B" instead of the original
"Track A or Track B". The day-90 outcomes also fork:

- Track A or Track AI succeeds → continue building that shape.
- Track A or Track AI fails → fall back to Track B.

Founder time budget is unchanged (~1 day/week), but the *use*
of that day differs sharply:
- Track A day: cold outreach to consultants, invoicing build-out
- Track AI day: content (X/HN/video), MCP integration support,
  AI-builder community engagement

These are not interchangeable. Pick one in week 1 and commit.

---

## 13. Sign-off

| Role     | Name        | Date        | Decision        |
|----------|-------------|-------------|-----------------|
| Founder  | Ramon Bartl |             | Track A / Track AI / Track B |

On Track AI approval, week 1 starts the following Monday. Day-30
checkpoint: §7 wk 2–3 features shipped + soft launch live. Day-60
checkpoint: HN/PH launch results, paying customer count. Day-90
review: §9 metrics, binary decision.
