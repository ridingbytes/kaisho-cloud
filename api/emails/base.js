"use strict"

// Shared HTML shell and styles for Kaisho emails.

const ACCENT = "#18181b"
const DARK   = "#18181b"
const MUTED  = "#52525b"
const BG     = "#fafafa"
const WHITE  = "#ffffff"
const BORDER = "#e4e4e7"
const FONT   =
  "-apple-system, BlinkMacSystemFont, " +
  "'Segoe UI', sans-serif"

function wrap({ title, preview, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport"
        content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};
             font-family:${FONT};">

  <div style="display:none;max-height:0;overflow:hidden;
              color:${BG};">
    ${esc(preview)}
  </div>

  <table width="100%" cellpadding="0" cellspacing="0"
         style="background:${BG};padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0"
               style="max-width:520px;">

          <tr>
            <td style="padding-bottom:24px;
                       text-align:center;">
              <span style="font-size:22px;font-weight:700;
                           color:${DARK};
                           letter-spacing:0.06em;">
                KAISHO
              </span>
            </td>
          </tr>

          <tr>
            <td style="background:${WHITE};
                       border:1px solid ${BORDER};
                       border-radius:10px;
                       padding:36px 40px;">
              ${body}
            </td>
          </tr>

          <tr>
            <td style="padding-top:24px;text-align:center;
                       font-size:12px;color:${MUTED};">
              Kaisho &mdash; your work, structured.<br/>
              You received this email because you have
              a Kaisho Cloud account.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`
}

function h1(text) {
  return `<h1 style="margin:0 0 8px;font-size:22px;
                     font-weight:700;color:${DARK};">
            ${esc(text)}
          </h1>`
}

function p(text) {
  return `<p style="margin:0 0 16px;font-size:15px;
                    line-height:1.6;color:${MUTED};">
            ${text}
          </p>`
}

function hr() {
  return `<hr style="border:none;
                     border-top:1px solid ${BORDER};
                     margin:24px 0;" />`
}

function label(text) {
  return `<p style="margin:0 0 4px;font-size:11px;
                    font-weight:600;color:${MUTED};
                    text-transform:uppercase;
                    letter-spacing:0.06em;">
            ${esc(text)}
          </p>`
}

function codeBlock(text) {
  return `<div style="background:${BG};
                      border:1px solid ${BORDER};
                      border-radius:6px;
                      padding:12px 16px;
                      font-family:'SF Mono','Fira Code',
                        monospace;
                      font-size:13px;color:${DARK};
                      word-break:break-all;">
            ${esc(text)}
          </div>`
}

function button(text, url) {
  return `<a href="${esc(url)}"
             style="display:inline-block;margin-top:8px;
                    padding:11px 24px;
                    background:${ACCENT};
                    color:${WHITE};font-size:14px;
                    font-weight:600;
                    text-decoration:none;
                    border-radius:6px;">
            ${esc(text)}
          </a>`
}

function note(text) {
  return `<p style="margin:16px 0 0;font-size:12px;
                    color:${MUTED};line-height:1.5;">
            ${text}
          </p>`
}

function planBadge(plan) {
  return `<span style="display:inline-block;
                       padding:3px 12px;
                       background:${ACCENT};
                       color:${WHITE};
                       border-radius:4px;
                       font-size:12px;font-weight:700;
                       letter-spacing:0.06em;
                       text-transform:uppercase;">
            ${esc(plan)}
          </span>`
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

module.exports = {
  wrap, h1, p, hr, label, codeBlock,
  button, note, planBadge,
}
