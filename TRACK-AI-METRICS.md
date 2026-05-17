# KAISHO Track AI — Kill-or-Pivot Tracker

Companion to `AI-COMPANION-PIVOT.md` §9. Updated weekly. Day-90
decision is made against the values in the "Current" column at
the row marked **Day 90**.

---

## Decision

- **Track**: AI (Local-first AI work companion).
- **Decided on**: 2026-05-17
- **Day 0 (launch)**: 2026-05-17
- **Day 90 (decision)**: 2026-08-15
- **Day 120 (extension cut-off, if mixed)**: 2026-09-14

## Tagline (locked)

> **Give your AI a memory, a calendar, and a to-do list.**

Rationale: concrete (names the three things), short enough for a
tweet header, model-agnostic (works whether the reader uses
Claude, GPT, Gemini, or a local Ollama), aligns with the
developer/AI-builder ICP. Earlier draft used "Give Claude…" but
naming a single vendor in the headline narrowed the ICP without a
real upside.

Alternates kept in reserve:
- "Your AI's long-term memory. Local-first."
- "The AI companion that runs on your schedule, on your hardware."

## Product naming

KAISHO stays as the umbrella. Tier names (Hobby / Companion /
Pro / Team) carry the meaning — no "KAISHO AI" sub-brand. Keeps
copy short and avoids confusing existing OSS users.

---

## The four metrics

| Metric                                          | Make-it | Drop-it | Day 0 | Current | Last updated |
|-------------------------------------------------|---------|---------|-------|---------|--------------|
| Paying customers                                | ≥ 20    | < 10    | 0     | 0       | 2026-05-17   |
| Blended MRR (€)                                 | ≥ 700   | < 400   | 0     | 0       | 2026-05-17   |
| GitHub stars net-new from Day 0                 | ≥ 300   | < 100   | 0     | 0       | 2026-05-17   |
| Active MCP integrations (paid users connected   | ≥ 10    | < 3     | 0     | 0       | 2026-05-17   |
|   to Claude Code / Cursor / Claude Desktop)     |         |         |       |         |              |

Refresh every Monday morning. Three minutes — paste the numbers,
bump the date. If the table stops getting filled, that is itself
a signal the project is drifting.

### How each number is sourced

- **Paying customers**: Stripe dashboard → Customers → active
  subscriptions, count rows.
- **MRR**: Stripe dashboard → Billing overview → MRR. Annual
  subs counted as `annual_price / 12`.
- **GitHub stars net-new**: `gh api repos/ridingbytes/kaisho |
  jq .stargazers_count`, subtract Day 0 baseline (TODO: record
  baseline on Week 1 sign-off day).
- **Active MCP integrations**: count of paid tenants whose
  `last_mcp_request_at` (TODO: add to `api/`) is within the
  last 14 days. Until the column ships, count manually from the
  support inbox + Discord/email replies.

---

## Outcome rules (verbatim from the pivot paper §9)

- **All four "make" thresholds met** → continue. Invest in: more
  MCP integrations, lexoffice OAuth if Team customers ask for
  it, more cron templates, a Claude Code skill / Cursor rule
  pack that ships alongside KAISHO. Consider a part-time
  growth contractor for content.
- **All four "drop" thresholds met** → fall back to Track B on
  day 91. Open-source `kaisho-cloud`, shut down the hosted
  instance, archive Stripe products, redirect kaisho.dev to a
  donation page. The desktop OSS app continues.
- **Mixed** → 30-day extension on a single named hypothesis.
  Maximum one extension. If Day-120 numbers do not cross the
  "make" thresholds, fall back to Track B.

---

## Week-by-week log

### Week 0 (2026-05-17) — Sign-off

- Track AI selected over Track A and Track B.
- Tagline locked.
- This tracker opened.
- TODO this week: record Day 0 GitHub star baseline; publish
  the hero rewrite on kaisho.dev.
