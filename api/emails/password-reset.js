"use strict"

const { wrap, h1, p, button, note } = require("./base")

/**
 * Render password reset email HTML.
 *
 * @param {object} params
 * @param {string} params.resetUrl - Full reset link URL.
 * @returns {string} HTML string.
 */
function renderPasswordReset({ resetUrl }) {
  const body = [
    h1("Reset your password"),
    p(
      "We received a request to reset your "
      + "Kaisho Cloud password. Click the button "
      + "below to choose a new password.",
    ),
    button("Reset Password", resetUrl),
    note(
      "This link expires in 1 hour. If you did "
      + "not request a password reset, you can "
      + "safely ignore this email.",
    ),
  ].join("")

  return wrap({
    title: "Reset your password",
    preview: "Reset your Kaisho Cloud password",
    body,
  })
}

module.exports = { renderPasswordReset }
