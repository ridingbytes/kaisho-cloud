"use strict"

/**
 * @module integrations/google
 *
 * Google Calendar premium integration (Pro tier).
 * Connected via OAuth (see oauth.js). Google access tokens
 * expire (~1h), so this module exports ``refresh()`` — the
 * gateway union calls it and persists the new token before
 * dispatch when the stored token is near expiry. Tools are
 * namespaced ``google_*`` and act on the user's primary
 * calendar.
 */

const { z } = require("zod")

const KIND = "google"
const CAL = "https://www.googleapis.com/calendar/v3"
const TOKEN = "https://oauth2.googleapis.com/token"

/**
 * Call the Calendar API with a bearer access token.
 *
 * @param {string} token
 * @param {string} path - e.g. "/calendars/primary/events".
 * @param {object} [opts] - fetch options (method, body).
 * @returns {Promise<object>}
 */
async function api(token, path, opts = {}) {
  const res = await fetch(`${CAL}${path}`, {
    ...opts,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  if (!res.ok) {
    const msg = json?.error?.message || res.status
    throw new Error(`Google Calendar API: ${msg}`)
  }
  return json
}

/**
 * Refresh the access token from the stored refresh_token.
 * Returned object is persisted by the gateway union.
 *
 * @param {object} credentials - { access_token,
 *   refresh_token }.
 * @returns {Promise<{credentials: object, expiresAt: string}>}
 */
async function refresh(credentials) {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: credentials.refresh_token,
      grant_type: "refresh_token",
    }),
  })
  const json = await res.json()
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Google token refresh: ${json.error || res.status}`,
    )
  }
  return {
    // Keep the refresh_token (Google omits it on refresh).
    credentials: {
      ...credentials,
      access_token: json.access_token,
    },
    expiresAt: new Date(
      Date.now() + (json.expires_in || 3600) * 1000,
    ).toISOString(),
  }
}

function tools() {
  return [
    {
      name: "google_list_events",
      title: "List Google Calendar events",
      description:
        "List upcoming events on the primary calendar. "
        + "ISO-8601 from/to bound the window (default: "
        + "from now).",
      inputSchema: {
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    {
      name: "google_freebusy",
      title: "Google Calendar free/busy",
      description:
        "Return busy intervals on the primary calendar "
        + "between from and to (ISO-8601, both required).",
      inputSchema: {
        from: z.string().min(1),
        to: z.string().min(1),
      },
    },
    {
      name: "google_create_event",
      title: "Create a Google Calendar event",
      description:
        "Create an event on the primary calendar. "
        + "start/end are ISO-8601 date-times.",
      inputSchema: {
        summary: z.string().min(1),
        start: z.string().min(1),
        end: z.string().min(1),
        description: z.string().optional(),
      },
    },
  ]
}

const CLAMP_MAX = 100

function clampLimit(n) {
  const v = Number.isFinite(n) ? Math.floor(n) : 25
  return Math.max(1, Math.min(v, CLAMP_MAX))
}

async function dispatch(tool, args, credentials) {
  const token = credentials.access_token
  if (tool === "google_list_events") {
    const params = new URLSearchParams({
      timeMin: args.from || new Date().toISOString(),
      maxResults: String(clampLimit(args.limit)),
      singleEvents: "true",
      orderBy: "startTime",
    })
    if (args.to) params.set("timeMax", args.to)
    const json = await api(
      token, `/calendars/primary/events?${params}`,
    )
    return (json.items || []).map((e) => ({
      id: e.id,
      summary: e.summary,
      start: e.start,
      end: e.end,
      html_link: e.htmlLink,
    }))
  }
  if (tool === "google_freebusy") {
    const json = await api(token, "/freeBusy", {
      method: "POST",
      body: JSON.stringify({
        timeMin: args.from,
        timeMax: args.to,
        items: [{ id: "primary" }],
      }),
    })
    return json.calendars?.primary?.busy || []
  }
  if (tool === "google_create_event") {
    const json = await api(
      token, "/calendars/primary/events",
      {
        method: "POST",
        body: JSON.stringify({
          summary: args.summary,
          description: args.description,
          start: { dateTime: args.start },
          end: { dateTime: args.end },
        }),
      },
    )
    return {
      id: json.id,
      summary: json.summary,
      html_link: json.htmlLink,
    }
  }
  throw new Error(`Unknown tool: ${tool}`)
}

module.exports = { KIND, tools, dispatch, refresh }
