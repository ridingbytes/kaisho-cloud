"use strict"

const { wrap, h1, p, hr } = require("./base")

function renderPlanCancelled() {
  return wrap({
    title: "Subscription cancelled",
    preview: "Your Kaisho Cloud subscription has ended.",
    body: [
      h1("Subscription cancelled"),
      p(
        "Your Kaisho Cloud subscription has been " +
        "cancelled. Your local Kaisho app continues " +
        "to work as before with all features.",
      ),
      hr(),
      p(
        "Cloud sync and mobile clock tracking are no " +
        "longer active. Any unsynced clock entries " +
        "will remain in the cloud for 30 days.",
      ),
      p(
        "You can resubscribe at any time from the " +
        "Kaisho Cloud mobile page.",
      ),
    ].join(""),
  })
}

module.exports = { renderPlanCancelled }
