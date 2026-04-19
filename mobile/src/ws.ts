/**
 * WebSocket client for real-time events from the cloud.
 *
 * Connects with the user's access token for auth.
 * Components register handlers via onWsEvent() without
 * coupling to the socket directly.
 */

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null =
  null
let reconnectDelay = 1000
let token = ""

const MAX_RECONNECT_DELAY = 30000

type EventHandler = (
  data: Record<string, unknown>,
) => void

const listeners = new Map<string, Set<EventHandler>>()

/** Register a handler for a WS event type.
 *  Returns an unsubscribe function. */
export function onWsEvent(
  event: string,
  handler: EventHandler,
): () => void {
  if (!listeners.has(event)) {
    listeners.set(event, new Set())
  }
  listeners.get(event)!.add(handler)
  return () => listeners.get(event)?.delete(handler)
}

function dispatch(
  event: string,
  data: Record<string, unknown>,
) {
  const handlers = listeners.get(event)
  if (!handlers) return
  for (const fn of handlers) {
    try {
      fn(data)
    } catch (err) {
      console.error(
        `[ws] handler error for ${event}:`, err,
      )
    }
  }
}

/** Connect to the cloud WebSocket. */
export function connectWs(accessToken: string) {
  token = accessToken
  doConnect()
}

/** Disconnect and stop reconnecting. */
export function disconnectWs() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.onclose = null
    ws.close()
    ws = null
  }
}

/** Update the access token (after refresh). */
export function updateWsToken(newToken: string) {
  token = newToken
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close()
  }
}

function doConnect() {
  if (ws && ws.readyState === WebSocket.OPEN) return

  const base = window.location.origin
    .replace(/^http/, "ws")
  const url = `${base}/ws`

  ws = new WebSocket(url)

  ws.onopen = () => {
    ws?.send(JSON.stringify({
      type: "auth",
      token,
    }))
    reconnectDelay = 1000
    dispatch("ws:connected", {})
  }

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data as string) as {
        event: string
        data: Record<string, unknown>
      }
      dispatch(msg.event, msg.data || {})
    } catch (err) {
      console.warn("[ws] malformed message:", err)
    }
  }

  ws.onclose = () => {
    ws = null
    scheduleReconnect()
  }

  ws.onerror = () => {
    // onclose fires after onerror
  }
}

/** Add +/- 20% jitter to prevent thundering herd. */
function jitter(ms: number): number {
  return ms * (0.8 + 0.4 * Math.random())
}

function scheduleReconnect() {
  if (reconnectTimer) return
  const delay = jitter(reconnectDelay)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    reconnectDelay = Math.min(
      reconnectDelay * 2,
      MAX_RECONNECT_DELAY,
    )
    doConnect()
  }, delay)
}
