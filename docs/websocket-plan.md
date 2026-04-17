# WebSocket Plan: Replace Polling with Real-Time Events

## Current State

The mobile PWA polls `GET /clocks/active` every 5 seconds to
detect timers started on other devices. The local desktop app
polls the same endpoint for cloud-side timers. The cloud sync
runs on a 5-minute APScheduler interval.

This creates unnecessary load and latency:
- 5s timer polling = 720 requests/hour per connected client
- Sync delay up to 5 minutes for cross-device changes
- Mobile battery drain from constant HTTP requests

## Target State

WebSocket connections from both mobile and desktop clients to
the cloud server. The server pushes events when state changes,
eliminating all polling.


## Architecture

```
Desktop App          Cloud Server          Mobile PWA
     |                    |                     |
     |--- WS connect ---->|<---- WS connect ----|
     |                    |                     |
     |    (user starts timer on mobile)         |
     |                    |<--- POST /start ----|
     |                    |                     |
     |<-- timer:started --|-- timer:started --->|
     |                    |                     |
     |    (user stops timer on desktop)         |
     |--- POST /stop ---->|                     |
     |                    |                     |
     |<-- timer:stopped --|-- timer:stopped --->|
     |                    |                     |
     |    (sync pushes new entries)             |
     |--- POST /apply --->|                     |
     |                    |                     |
     |<-- entries:changed-|-- entries:changed ->|
```


## Event Types

| Event | Payload | Triggered By |
|-------|---------|--------------|
| `timer:started` | `{id, customer, description, start}` | POST /clocks/start |
| `timer:stopped` | `{id, customer, start, end, duration}` | POST /clocks/stop |
| `entries:changed` | `{count, last_change_at}` | POST /sync/apply, CRUD |
| `entries:deleted` | `{ids}` | DELETE entries |
| `sync:snapshot` | `{customers, tasks}` | POST /sync/push-snapshot |
| `ping` | `{}` | Server heartbeat (30s) |


## Implementation Steps

### Phase 1: Cloud Server WebSocket Infrastructure

**File: `api/ws.js` (new)**

```
const WebSocket = require("ws")

// Per-user connection map: userId -> Set<WebSocket>
const userSockets = new Map()

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server, path: "/ws" })

  wss.on("connection", (ws, req) => {
    // Auth: extract token from query string or first message
    // Add to userSockets map
    // Handle disconnect cleanup
    // Start 30s ping/pong heartbeat
  })
}

function broadcast(userId, event, data) {
  // Send to all sockets for this user
  const sockets = userSockets.get(userId)
  if (!sockets) return
  const msg = JSON.stringify({ event, data })
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg)
    }
  }
}
```

**Auth approach**: The client connects with the access token
as a query parameter: `wss://cloud.kaisho.dev/ws?token=<jwt>`.
The server validates the JWT on connection, same as REST auth.
For API key auth (desktop), use `?api_key=<key>`.

**Heartbeat**: Server sends `ping` every 30 seconds. Client
responds with `pong`. Connections without pong after 60 seconds
are terminated and cleaned up.

### Phase 2: Emit Events from Existing Routes

Update existing route handlers to broadcast after mutations:

**`api/routes/clocks.js`**:
- `POST /clocks/start` -> broadcast `timer:started`
- `POST /clocks/stop` -> broadcast `timer:stopped`
- `PATCH /clocks/:id` -> broadcast `entries:changed`
- `DELETE /clocks/:id` -> broadcast `entries:deleted`

**`api/routes/sync.js`**:
- `POST /sync/apply` -> broadcast `entries:changed`
- `POST /sync/active/start` -> broadcast `timer:started`
- `POST /sync/active/stop` -> broadcast `timer:stopped`
- `POST /sync/push-snapshot` -> broadcast `sync:snapshot`

Each broadcast call gets the `userId` from `req.userId` (set
by the auth middleware before the route handler runs).

### Phase 3: Mobile PWA WebSocket Client

**File: `mobile/src/ws.ts` (new)**

```typescript
let ws: WebSocket | null = null
let reconnectTimer: number | null = null
const listeners = new Map<string, Set<Function>>()

function connect(token: string) {
  const url = `${wsUrl}/ws?token=${token}`
  ws = new WebSocket(url)

  ws.onmessage = (e) => {
    const { event, data } = JSON.parse(e.data)
    const handlers = listeners.get(event)
    if (handlers) {
      for (const fn of handlers) fn(data)
    }
  }

  ws.onclose = () => {
    // Reconnect with exponential backoff
    reconnectTimer = setTimeout(
      () => connect(token),
      3000,
    )
  }
}

function on(event: string, handler: Function) {
  // Register event listener
}

function off(event: string, handler: Function) {
  // Remove event listener
}
```

**Integration with existing components:**

- `TimerView.tsx`: Remove 5s `setInterval`. Listen to
  `timer:started` and `timer:stopped` events. The 1s elapsed
  tick stays (it's purely cosmetic).

- `EntriesView.tsx`: Listen to `entries:changed` to refresh
  the list instead of manual fetch-after-mutation.

- `DashboardView.tsx`: Listen to `entries:changed` to refresh
  totals.

### Phase 4: Desktop App Cloud WebSocket

**File: `kaisho/services/cloud_ws.py` (new)**

The desktop app connects to the cloud WebSocket for real-time
notifications about changes from other devices (mobile).

```python
import asyncio
import websocket  # websocket-client library

def connect_cloud_ws(url, api_key, on_event):
    ws_url = url.replace("http", "ws") + "/ws"
    ws_url += f"?api_key={api_key}"

    ws = websocket.WebSocketApp(
        ws_url,
        on_message=lambda ws, msg: on_event(
            json.loads(msg)
        ),
        on_close=lambda *a: schedule_reconnect(),
    )
    ws.run_forever()
```

**Event handling:**

- `timer:started` -> Update local active timer display,
  invalidate `useCloudActiveTimer` query
- `timer:stopped` -> Clear local cloud timer display
- `entries:changed` -> Trigger an immediate sync cycle
  instead of waiting 5 minutes

This replaces:
- The 5-second `useCloudActiveTimer` polling
- The 5-minute sync interval (sync on demand when notified)

### Phase 5: Remove Polling

Once WebSocket is stable:

1. **Mobile**: Remove `setInterval(refreshActive, 5000)`
   from `TimerView.tsx` (line 82). Keep `visibilitychange`
   as a fallback (in case WS was disconnected while in
   background).

2. **Desktop**: Remove `refetchInterval: 5_000` from
   `useCloudActiveTimer()` in `useSettings.ts` (line 355).

3. **Sync scheduler**: Change `__cloud_sync__` from 5-minute
   interval to on-demand (triggered by WS `entries:changed`
   event). Keep a 15-minute fallback interval for resilience.


## Migration Strategy

Ship in two phases to avoid breaking changes:

**Phase A** (additive): Add WebSocket alongside polling.
Both work simultaneously. WebSocket provides instant updates,
polling acts as fallback. No user-visible change except
faster responses.

**Phase B** (cleanup): After 2 weeks of Phase A running
stable, remove polling intervals. Keep `visibilitychange`
and staleTime-based refetch as fallbacks for reconnection
scenarios.


## Dependencies

- Cloud server: `ws` npm package (lightweight, no socket.io
  needed)
- Desktop app: `websocket-client` Python package (already
  has `websockets` for the local WS, but `websocket-client`
  is simpler for a client)
- Mobile: Native browser `WebSocket` API (no library needed)


## Estimated Complexity

| Phase | Effort | Files Changed |
|-------|--------|---------------|
| Phase 1: Server WS | Medium | 2 new, 1 modified (server.js) |
| Phase 2: Emit events | Low | 2 modified (clocks.js, sync.js) |
| Phase 3: Mobile client | Medium | 1 new, 3 modified |
| Phase 4: Desktop client | Medium | 1 new, 2 modified |
| Phase 5: Remove polling | Low | 3 modified |
