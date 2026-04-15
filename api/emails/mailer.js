"use strict"

/**
 * Transactional email sender using Resend.
 */

const { Resend } = require("resend")
const { logger } = require("../logger")
const { renderWelcome } = require("./welcome")
const { renderPlanUpgrade } = require("./plan-upgrade")
const { renderPlanCancelled } = require("./plan-cancelled")

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM =
  process.env.EMAIL_FROM || "Kaisho <noreply@kaisho.dev>"

/**
 * Send a welcome email with the initial API key.
 *
 * @param {object} params
 * @param {string} params.email - Recipient address.
 * @param {string} params.apiKey - Generated API key.
 */
async function sendWelcomeEmail({ email, apiKey }) {
  try {
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: "Welcome to Kaisho Cloud",
      html: renderWelcome({ apiKey }),
    })
  } catch (err) {
    logger.error(
      { err, email },
      "sendWelcomeEmail failed",
    )
  }
}

/**
 * Send an email with a newly rotated API key.
 *
 * @param {object} params
 * @param {string} params.email - Recipient address.
 * @param {string} params.apiKey - New API key.
 */
async function sendNewApiKeyEmail({ email, apiKey }) {
  try {
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: "New Kaisho Cloud API key",
      html: renderWelcome({ apiKey }),
    })
  } catch (err) {
    logger.error(
      { err, email },
      "sendNewApiKeyEmail failed",
    )
  }
}

/**
 * Send a plan upgrade confirmation email.
 *
 * @param {object} params
 * @param {string} params.email - Recipient address.
 * @param {string} params.plan - New plan name.
 */
async function sendPlanUpgradeEmail({ email, plan }) {
  try {
    await resend.emails.send({
      from: FROM,
      to: email,
      subject:
        `Your Kaisho plan has been upgraded to ${plan}`,
      html: renderPlanUpgrade({ plan }),
    })
  } catch (err) {
    logger.error(
      { err, email },
      "sendPlanUpgradeEmail failed",
    )
  }
}

/**
 * Send a subscription cancellation notice.
 *
 * @param {object} params
 * @param {string} params.email - Recipient address.
 */
async function sendPlanCancelledEmail({ email }) {
  try {
    await resend.emails.send({
      from: FROM,
      to: email,
      subject:
        "Your Kaisho Cloud subscription " +
        "has been cancelled",
      html: renderPlanCancelled(),
    })
  } catch (err) {
    logger.error(
      { err, email },
      "sendPlanCancelledEmail failed",
    )
  }
}

module.exports = {
  sendWelcomeEmail,
  sendNewApiKeyEmail,
  sendPlanUpgradeEmail,
  sendPlanCancelledEmail,
}
