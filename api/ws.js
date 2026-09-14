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
 * Connection: open wss://cloud.kaisho.dev/ws and send
 *   ``{"type":"auth","token":"<jwt>"}`` (or ``api_key``)
 *   as the first message. Query-string auth was removed
 *   because access logs / Traefik captured the token in
 *   the URL.
 */

const WebSocket = require("ws")
const bcrypt = require("bcryptjs")
const { logger } = require("./logger")
const {
  supabase,
  getCachedUser,
  cacheUser,
} = require("./db")
const { verifyAccess } = require("./auth/session")

// Per-user connection map: userId -> Set<WebSocket>
const userSockets = new Map()

// Heartbeat interval (30s ping, 60s timeout)
const HEARTBEAT_MS = 30000

/**
 * Authenticate a WebSocket connection from the auth
 * message's token or api_key.
 *
 * @param {string} token - JWT access token.
 * @param {string} apiKey - API key (alternative).
 * @returns {Promise<string|null>} User ID or null.
 */
async function authenticate(token, apiKey) {
  // Try JWT first
  if (token) {
    const session = await verifyAccess(token)
    if (session) {
      return session.userId
    }
  }

  // Try API key
  if (apiKey) {
    // Keyed by the key alone, so this lookup does not
    // depend on the candidate query and runs before it.
    // It used to be called as getCachedUser(user.id,
    // apiKey) from inside the loop, which cached the key
    // under a hash of the user id and stored the key
    // string as the "user". The next connect read that
    // string back, found no .id on it, and closed the
    // socket with 4001 while the very same key still
    // worked over HTTP.
    const cached = getCachedUser(apiKey)
    if (cached) return cached.id

    const prefix = apiKey.slice(0, 8)
    const { data: users } = await supabase
      .from("users")
      .select("id, plan, api_key_hash, disabled_at")
      .eq("api_key_prefix", prefix)
      .limit(5)

    for (const user of users || []) {
      const match = await bcrypt.compare(
        apiKey, user.api_key_hash,
      )
      if (!match) continue
      // Same rule as requireApiKey, which answers 403 for
      // a disabled account. Without this the HTTP API goes
      // silent on a disabled key while its realtime feed
      // keeps delivering.
      if (user.disabled_at) return null
      cacheUser(apiKey, user)
      return user.id
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

  wss.on("connection", async (ws) => {
    ws.isAlive = true
    ws.on("pong", () => { ws.isAlive = true })

    // Auth via first message only:
    //   {"type":"auth","token":"<jwt>"} or
    //   {"type":"auth","api_key":"<key>"}
    // Query-string auth was removed (H7) because access
    // logs and Traefik captured the secret in req.url.
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
  // Exported for the auth regression test: the bug it
  // covers only shows on the second call, which a test
  // cannot reach through a live socket handshake.
  authenticate,
}
