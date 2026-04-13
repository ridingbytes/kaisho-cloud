"use strict"

const { wrap, h1, p, hr, planBadge } = require("./base")

function renderPlanUpgrade({ plan }) {
  const features = {
    sync: [
      "Mobile clock tracking",
      "Automatic sync to local app",
      "Customer and task reference data",
    ],
    sync_ai: [
      "Everything in Cloud Sync",
      "AI advisor queries (~100/month)",
      "No API key management needed",
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
      p("Thank you for supporting Kaisho."),
    ].join(""),
  })
}

module.exports = { renderPlanUpgrade }
