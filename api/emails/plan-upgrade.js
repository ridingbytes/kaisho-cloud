"use strict"

const {
  wrap, h1, p, hr, planBadge, note,
} = require("./base")

function renderPlanUpgrade({ plan }) {
  const features = {
    companion: [
      "Bidirectional clock and task sync across devices",
      "Mobile PWA with offline timer",
      "AI gateway: 500,000 tokens per month",
      "Hosted MCP server — connect Claude, ChatGPT, " +
        "Cursor, or any MCP client to your data",
      "Hosted cron worker for recurring tasks",
    ],
    pro: [
      "Everything in Companion",
      "AI gateway: 2,000,000 tokens per month",
      "Premium integrations: Linear, GitHub Projects, " +
        "Google Calendar, Slack",
      "Priority queue on the AI gateway",
    ],
    team: [
      "Everything in Pro for each seat",
      "Shared workspace with role-based access",
      "Centralised billing and seat management",
      "Per-seat 2,000,000 token monthly quota",
    ],
  }

  const items = features[plan] || features.companion
  const list = items
    .map(
      (item) =>
        `<li style="margin:0 0 6px;font-size:14px;` +
        `color:#52525b;line-height:1.5;">${item}</li>`,
    )
    .join("")

  return wrap({
    title: `Upgraded to ${plan}`,
    preview: `Your Kaisho plan is now ${plan}.`,
    body: [
      h1("Plan upgraded"),
      p(
        `Your Kaisho Cloud plan is now ` +
        `${planBadge(plan)}`,
      ),
      hr(),
      `<ul style="margin:0 0 16px;padding-left:20px;">` +
        `${list}</ul>`,
      hr(),
      p(
        "<strong>Connect your desktop app</strong>" +
        "<br/>Open the mobile app &rarr; Profile " +
        "&rarr; Generate new key &rarr; copy the " +
        "CLI command and run it in a terminal:<br/>" +
        "<code>kai cloud connect " +
        "https://cloud.kaisho.dev &lt;key&gt;</code>",
      ),
      note(
        "Or open Kaisho Settings &rarr; Cloud " +
        "Sync and paste the URL + API key manually.",
      ),
    ].join(""),
  })
}

module.exports = { renderPlanUpgrade }
