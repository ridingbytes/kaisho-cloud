"use strict"

/**
 * Transactional email sender using Resend.
 */

const { Resend } = require("resend")
const { logger } = require("../logger")
const { renderWelcome } = require("./welcome")
const { renderPasswordReset } = require("./password-reset")

// Email is optional. Without RESEND_API_KEY (common for a
// self-hosted instance) sends become no-ops instead of throwing
// at construction, so the server still boots. Callers already
// treat delivery as best-effort.
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : {
    emails: {
      send: async () => {
        logger.debug("email skipped: RESEND_API_KEY not set")
      },
    },
  }
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
/**
 * Send a password reset email with a reset link.
 *
 * @param {object} params
 * @param {string} params.email - Recipient address.
 * @param {string} params.resetUrl - Full reset URL.
 */
async function sendPasswordResetEmail({
  email, resetUrl,
}) {
  try {
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: "Reset your Kaisho password",
      html: renderPasswordReset({ resetUrl }),
    })
  } catch (err) {
    logger.error(
      { err, email },
      "sendPasswordResetEmail failed",
    )
  }
}

module.exports = {
  sendWelcomeEmail,
  sendPasswordResetEmail,
}
