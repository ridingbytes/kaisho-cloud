/**
 * WebSocket client for real-time events from the cloud.
 *
 * Connects with the user's access token for auth.
 * Emits custom DOM events that components can listen to
 * without coupling to the WebSocket directly.
 */

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null =
  null
let reconnectDelay = 1000
let token = ""

const MAX_RECONNECT_DELAY = 30000

type EventHandler = (data: Record<string, unknown>) => void
const listeners = new Map<string, Set<EventHandler>>()

/** Register a handler for a WS event type. */
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

/** Dispatch to registered handlers. */
function dispatch(
  event: string,
  data: Record<string, unknown>,
) {
  const handlers = listeners.get(event)
  if (!handlers) return
  for (const fn of handlers) {
    try {
      fn(data)
    } catch {
      /* handler errors don't break the WS loop */
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
  // Reconnect with new token if currently connected
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close()
    // onclose handler will trigger reconnect
  }
}

function doConnect() {
  if (ws && ws.readyState === WebSocket.OPEN) return

  const base = window.location.origin
    .replace(/^http/, "ws")
  const url = `${base}/ws?token=${token}`

  ws = new WebSocket(url)

  ws.onopen = () => {
    reconnectDelay = 1000
    dispatch("ws:connected", {})
  }

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data) as {
        event: string
        data: Record<string, unknown>
      }
      dispatch(msg.event, msg.data || {})
    } catch {
      /* ignore malformed messages */
    }
  }

  ws.onclose = () => {
    ws = null
    scheduleReconnect()
  }

  ws.onerror = () => {
    // onclose fires after onerror, reconnect happens there
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    reconnectDelay = Math.min(
      reconnectDelay * 2,
      MAX_RECONNECT_DELAY,
    )
    doConnect()
  }, reconnectDelay)
}
