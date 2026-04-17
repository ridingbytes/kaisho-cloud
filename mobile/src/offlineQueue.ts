/**
 * Offline mutation queue.
 *
 * Wraps mutating API calls so they survive flaky mobile
 * connections. When ``fetch`` fails with a network-level
 * error, the operation is queued in ``localStorage`` and
 * retried when:
 *   - the browser fires an ``online`` event
 *   - the PWA tab regains focus
 *   - a subsequent mutation triggers a flush
 *
 * Reads are never queued — stale-until-reachable UX is
 * cheaper than replaying reads with invalidated state.
 */

const STORAGE_KEY = "kaisho:offline-queue"

export interface QueuedRequest {
  id: string
  path: string
  method: "POST" | "PATCH" | "PUT" | "DELETE"
  body: unknown
  createdAt: string
}

type Runner = (req: QueuedRequest) => Promise<Response>

let runner: Runner | null = null
let flushing = false
let listenersInstalled = false

// ── Storage ────────────────────────────────────────────

function load(): QueuedRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function save(queue: QueuedRequest[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
}

// ── Public API ─────────────────────────────────────────

export function configureQueue(run: Runner): void {
  runner = run
  ensureListeners()
}

export function queueRequest(
  req: Omit<QueuedRequest, "id" | "createdAt">,
): void {
  const queue = load()
  queue.push({
    ...req,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  })
  save(queue)
  notifyListeners()
}

export function queueSize(): number {
  return load().length
}

export async function flushQueue(): Promise<number> {
  if (flushing || !runner) return 0
  flushing = true
  let drained = 0
  try {
    while (true) {
      const queue = load()
      if (queue.length === 0) break
      const next = queue[0]
      try {
        const res = await runner(next)
        if (!res.ok && res.status < 500) {
          // 4xx: non-retryable. Drop and move on so we
          // don't get stuck forever on a bad payload.
          save(queue.slice(1))
          drained++
          continue
        }
        if (!res.ok) break
        save(queue.slice(1))
        drained++
      } catch {
        // Network-level error. Stop; listeners will
        // retry later.
        break
      }
    }
  } finally {
    flushing = false
    notifyListeners()
  }
  return drained
}

// ── Subscription ───────────────────────────────────────

const listeners = new Set<() => void>()

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyListeners(): void {
  for (const l of listeners) l()
}

function ensureListeners(): void {
  if (listenersInstalled) return
  listenersInstalled = true
  window.addEventListener("online", () => {
    flushQueue()
  })
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      flushQueue()
    }
  })
}
