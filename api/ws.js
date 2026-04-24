"use strict"

/**
 * @module ws
 *
 * WebSocket server for real-time event broadcasting.
 * Clients connect with a JWT or API key for auth.
 * The server pushes events when state changes (timer
 * started/stopped, entries changed, etc.) so clients
 * don't need to poll.
 *
 * Connection: wss://cloud.kaisho.dev/ws?token=<jwt>
 *         or: wss://cloud.kaisho.dev/ws?api_key=<key>
 */

const WebSocket = require("ws")
const url = require("url")
const bcrypt = require("bcryptjs")
const { logger } = require("./logger")
const {
  supabase,
  supabaseAuth,
  getCachedUser,
  cacheUser,
} = require("./db")

// Per-user connection map: userId -> Set<WebSocket>
const userSockets = new Map()

// Heartbeat interval (30s ping, 60s timeout)
const HEARTBEAT_MS = 30000

/**
 * Authenticate a WebSocket connection from query params.
 *
 * @param {string} token - JWT access token.
 * @param {string} apiKey - API key (alternative).
 * @returns {Promise<string|null>} User ID or null.
 */
async function authenticate(token, apiKey) {
  // Try JWT first
  if (token) {
    const { data, error } =
      await supabaseAuth.auth.getUser(token)
    if (!error && data?.user) {
      return data.user.id
    }
  }

  // Try API key (prefix-based lookup)
  if (apiKey) {
    const prefix = apiKey.slice(0, 8)
    const { data: users } = await supabase
      .from("users")
      .select("id, plan, api_key_hash")
      .eq("api_key_prefix", prefix)
      .limit(5)

    if (users) {
      for (const user of users) {
        const cached = getCachedUser(
          user.id, apiKey,
        )
        if (cached) return cached.id

        const match = await bcrypt.compare(
          apiKey, user.api_key_hash,
        )
        if (match) {
          cacheUser(user.id, apiKey, user)
          return user.id
        }
      }
    }
  }

  return null
}

/**
 * Register a newly authenticated WebSocket connection.
 *
 * @param {WebSocket} ws - The WebSocket instance.
 * @param {string} userId - Authenticated user ID.
 */
function registerSocket(ws, userId) {
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set())
  }
  userSockets.get(userId).add(ws)

  logger.info(
    { userId, clients: userSockets.get(userId).size },
    "WS client connected",
  )

  ws.send(JSON.stringify({
    event: "connected",
    data: {
      devices: userSockets.get(userId).size,
    },
  }))

  ws.on("close", () => {
    removeSocket(ws)
    logger.info({ userId }, "WS client disconnected")
  })

  ws.on("error", (err) => {
    logger.error({ err, userId }, "WS error")
    removeSocket(ws)
  })
}

/**
 * Set up the WebSocket server on an existing HTTP server.
 *
 * @param {import("http").Server} server
 */
function setupWebSocket(server) {
  const wss = new WebSocket.Server({
    server,
    path: "/ws",
  })

  // Heartbeat: ping all clients every 30s
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        removeSocket(ws)
        ws.terminate()
        continue
      }
      ws.isAlive = false
      ws.ping()
    }
  }, HEARTBEAT_MS)

  wss.on("close", () => clearInterval(heartbeat))

  wss.on("connection", async (ws, req) => {
    ws.isAlive = true
    ws.on("pong", () => { ws.isAlive = true })

    // Auth via query string (legacy) or first message
    const params = new url.URL(
      req.url, "http://localhost",
    ).searchParams
    const qToken = params.get("token") || ""
    const qKey = params.get("api_key") || ""

    if (qToken || qKey) {
      // Legacy: auth from query string
      const userId = await authenticate(qToken, qKey)
      if (!userId) {
        ws.close(4001, "Unauthorized")
        return
      }
      ws.userId = userId
      registerSocket(ws, userId)
    } else {
      // Auth via first message: {"type":"auth",
      //   "token":"..."}
      const authTimeout = setTimeout(() => {
        if (!ws.userId) ws.close(4001, "Auth timeout")
      }, 5000)

      ws.once("message", async (raw) => {
        clearTimeout(authTimeout)
        try {
          const msg = JSON.parse(String(raw))
          if (
            msg.type !== "auth"
            || (!msg.token && !msg.api_key)
          ) {
            ws.close(4001, "Invalid auth message")
            return
          }
          const userId = await authenticate(
            msg.token || "",
            msg.api_key || "",
          )
          if (!userId) {
            ws.close(4001, "Unauthorized")
            return
          }
          ws.userId = userId
          registerSocket(ws, userId)
        } catch {
          ws.close(4001, "Invalid auth message")
        }
      })
      return
    }

  })

  logger.info("WebSocket server attached to /ws")
}

/**
 * Remove a socket from the user connection map.
 *
 * @param {WebSocket} ws
 */
function removeSocket(ws) {
  const userId = ws.userId
  if (!userId) return
  const sockets = userSockets.get(userId)
  if (!sockets) return
  sockets.delete(ws)
  if (sockets.size === 0) {
    userSockets.delete(userId)
  }
}

/**
 * Broadcast an event to all connected clients of a user.
 *
 * @param {string} userId - Target user.
 * @param {string} event - Event name.
 * @param {object} [data={}] - Event payload.
 */
function broadcast(userId, event, data = {}) {
  const sockets = userSockets.get(userId)
  if (!sockets || sockets.size === 0) return
  const msg = JSON.stringify({ event, data })
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg)
    }
  }
}

module.exports = {
  setupWebSocket,
  broadcast,
}
