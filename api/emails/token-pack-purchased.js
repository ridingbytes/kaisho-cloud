"use strict"

const {
  wrap, h1, p, hr, note,
} = require("./base")

/**
 * Render the Token Pack purchase confirmation email.
 *
 * Sent after a successful one-off Token Pack charge,
 * once the AI gateway has credited the new balance.
 *
 * @param {object} params
 * @param {number} params.tokens     - Tokens added.
 * @param {number} params.bonusTotal - New bonus balance.
 */
function renderTokenPackPurchased({ tokens, bonusTotal }) {
  const fmt = (n) => Number(n).toLocaleString("en-US")

  return wrap({
    title: "Token Pack added",
    preview:
      `${fmt(tokens)} bonus tokens added to your account.`,
    body: [
      h1("Token Pack added"),
      p(
        `<strong>${fmt(tokens)} tokens</strong> have been ` +
        "added to your Kaisho Cloud account.",
      ),
      hr(),
      p(
        "Bonus balance: " +
        `<strong>${fmt(bonusTotal)} tokens</strong>.`,
      ),
      p(
        "Bonus tokens stack on top of your monthly plan " +
        "quota and never expire. Your monthly quota " +
        "still resets on the usual cycle; the bonus " +
        "balance is consumed only after the monthly " +
        "allowance is exhausted.",
      ),
      note(
        "Need a receipt? Open the mobile app &rarr; " +
        "Profile &rarr; Manage subscription to view your " +
        "Stripe billing portal.",
      ),
    ].join(""),
  })
}

module.exports = { renderTokenPackPurchased }
