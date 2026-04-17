"use strict"

const {
  wrap, h1, p, hr, planBadge, note,
} = require("./base")

function renderPlanUpgrade({ plan }) {
  const features = {
    sync: [
      "Bidirectional clock sync across devices",
      "Mobile timer with offline support",
      "Customer and task reference data",
      "Dashboard with weekly and monthly stats",
    ],
    sync_ai: [
      "Everything in Cloud Sync",
      "AI-powered time summaries",
      "Natural language time booking",
      "Smart customer suggestions",
    ],
  }

  const items = features[plan] || features.sync
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
