"use strict"

const { Resend } = require("resend")
const { renderWelcome } = require("./welcome")
const { renderPlanUpgrade } = require("./plan-upgrade")
const { renderPlanCancelled } = require("./plan-cancelled")

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM =
  process.env.EMAIL_FROM || "Kaisho <noreply@kaisho.app>"

async function sendWelcomeEmail({ email, apiKey }) {
  try {
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: "Welcome to Kaisho Cloud",
      html: renderWelcome({ apiKey }),
    })
  } catch (err) {
    console.error("sendWelcomeEmail failed:", err.message)
  }
}

async function sendNewApiKeyEmail({ email, apiKey }) {
  try {
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: "New Kaisho Cloud API key",
      html: renderWelcome({ apiKey }),
    })
  } catch (err) {
    console.error(
      "sendNewApiKeyEmail failed:", err.message,
    )
  }
}

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
    console.error(
      "sendPlanUpgradeEmail failed:", err.message,
    )
  }
}

async function sendPlanCancelledEmail({ email }) {
  try {
    await resend.emails.send({
      from: FROM,
      to: email,
      subject:
        "Your Kaisho Cloud subscription has been cancelled",
      html: renderPlanCancelled(),
    })
  } catch (err) {
    console.error(
      "sendPlanCancelledEmail failed:", err.message,
    )
  }
}

module.exports = {
  sendWelcomeEmail,
  sendNewApiKeyEmail,
  sendPlanUpgradeEmail,
  sendPlanCancelledEmail,
}
