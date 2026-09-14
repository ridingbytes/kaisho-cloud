"use strict"

/**
 * @module integrations/slack
 *
 * Slack integration. Connected via
 * OAuth (see oauth.js) — the stored credential holds the
 * bot access token. Tools are namespaced ``slack_*``.
 */

const { z } = require("zod")

const KIND = "slack"
const API = "https://slack.com/api"

/**
 * Call a Slack Web API method with a bot token.
 *
 * @param {string} token - Bot access token (xoxb-…).
 * @param {string} method - e.g. "conversations.list".
 * @param {object} [params]
 * @param {"GET"|"POST"} [httpMethod]
 * @returns {Promise<object>} The Slack response (ok:true).
 */
async function slackApi(token, method, params, httpMethod) {
  const isPost = httpMethod === "POST"
  let url = `${API}/${method}`
  const opts = {
    method: httpMethod || "GET",
    headers: { "Authorization": `Bearer ${token}` },
  }
  if (isPost) {
    opts.headers["Content-Type"] =
      "application/json; charset=utf-8"
    opts.body = JSON.stringify(params || {})
  } else {
    const qs = new URLSearchParams(params || {}).toString()
    if (qs) url += `?${qs}`
  }
  const res = await fetch(url, opts)
  const json = await res.json()
  if (!json.ok) {
    throw new Error(`Slack API: ${json.error || res.status}`)
  }
  return json
}

function tools() {
  return [
    {
      name: "slack_list_channels",
      title: "List Slack channels",
      description:
        "List public channels in the connected workspace.",
      inputSchema: {
        limit: z.number().int().positive().optional(),
      },
    },
    {
      name: "slack_search_messages",
      title: "Search Slack messages",
      description:
        "Search public-channel messages by text query.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().positive().optional(),
      },
    },
    {
      name: "slack_post_message",
      title: "Post a Slack message",
      description:
        "Post a message to a channel (id from "
        + "slack_list_channels).",
      inputSchema: {
        channel: z.string().min(1),
        text: z.string().min(1),
      },
    },
  ]
}

const CLAMP_MAX = 100

function clampLimit(n) {
  const v = Number.isFinite(n) ? Math.floor(n) : 20
  return Math.max(1, Math.min(v, CLAMP_MAX))
}

async function dispatch(tool, args, credentials) {
  const token = credentials.access_token
  if (tool === "slack_list_channels") {
    const json = await slackApi(token, "conversations.list", {
      types: "public_channel",
      limit: clampLimit(args.limit),
      exclude_archived: "true",
    })
    return (json.channels || []).map((c) => ({
      id: c.id, name: c.name, topic: c.topic?.value || "",
      num_members: c.num_members,
    }))
  }
  if (tool === "slack_search_messages") {
    const json = await slackApi(token, "search.messages", {
      query: args.query,
      count: clampLimit(args.limit),
    })
    return (json.messages?.matches || []).map((m) => ({
      channel: m.channel?.name, user: m.username,
      text: m.text, ts: m.ts, permalink: m.permalink,
    }))
  }
  if (tool === "slack_post_message") {
    const json = await slackApi(
      token, "chat.postMessage",
      { channel: args.channel, text: args.text }, "POST",
    )
    return { ok: true, ts: json.ts, channel: json.channel }
  }
  throw new Error(`Unknown tool: ${tool}`)
}

module.exports = { KIND, tools, dispatch }
