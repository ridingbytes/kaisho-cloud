"use strict"

const { wrap, h1, p, hr, label, codeBlock, note } =
  require("./base")

function renderWelcome({ apiKey, appUrl }) {
  return wrap({
    title: "Welcome to Kaisho Cloud",
    preview: "Your API key for local sync.",
    body: [
      h1("Welcome to Kaisho Cloud"),
      p(
        "Your account is ready. Use the API key below " +
        "to connect your local Kaisho instance.",
      ),
      hr(),
      label("Your API key"),
      codeBlock(apiKey),
      note(
        "This key is shown only once. Store it in your " +
        "Kaisho settings under Cloud Sync.",
      ),
      hr(),
      p(
        "<strong>Getting started</strong><br/>" +
        "1. Open Kaisho &rarr; Settings &rarr; " +
        "Cloud Sync<br/>" +
        "2. Enter the cloud URL and this API key<br/>" +
        "3. Click Connect",
      ),
    ].join(""),
  })
}

module.exports = { renderWelcome }
