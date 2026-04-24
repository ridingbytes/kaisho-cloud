import type {
  ActiveTimer,
  ClockEntry,
  Customer,
  InboxItem,
  Note,
  SignupResult,
  Task,
  TaskRef,
  User,
} from "./types"
import {
  configureQueue,
  flushQueue,
  queueRequest,
  type QueuedRequest,
} from "./offlineQueue"

let accessToken: string | null = null
let refreshToken: string | null = null
let onAuthExpired: (() => void) | null = null
let onTokensRefreshed:
  | ((access: string, refresh: string) => void)
  | null = null

const MUTATING_METHODS = new Set([
  "POST", "PATCH", "PUT", "DELETE",
])

function isNetworkError(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    /fetch|network|load failed/i.test(err.message)
  )
}

export function setTokens(
  access: string,
  refresh: string,
) {
  accessToken = access
  refreshToken = refresh
}

export function clearTokens() {
  accessToken = null
  refreshToken = null
}

export function setOnTokensRefreshed(
  cb: (access: string, refresh: string) => void,
) {
  onTokensRefreshed = cb
}

export function setOnAuthExpired(cb: () => void) {
  onAuthExpired = cb
}

let refreshPromise: Promise<boolean> | null = null

async function refreshAccess(): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  refreshPromise = doRefreshAccess()
  try {
    return await refreshPromise
  } finally {
    refreshPromise = null
  }
}

async function doRefreshAccess(): Promise<boolean> {
  if (!refreshToken) return false
  const res = await fetch("/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) return false
  const data = await res.json()
  accessToken = data.access_token
  refreshToken = data.refresh_token
  onTokensRefreshed?.(accessToken!, refreshToken!)
  return true
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  }
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`
  }

  const method = (opts.method || "GET").toUpperCase()
  const queueable =
    MUTATING_METHODS.has(method) &&
    !path.startsWith("/auth/")

  let res: Response
  try {
    res = await fetch(path, { ...opts, headers })
  } catch (err) {
    if (queueable && isNetworkError(err)) {
      queueRequest({
        path,
        method: method as QueuedRequest["method"],
        body: opts.body
          ? JSON.parse(opts.body as string)
          : null,
      })
      throw new ApiError(
        0, "Offline — queued for retry",
      )
    }
    throw err
  }

  if (res.status === 401 && refreshToken) {
    const refreshed = await refreshAccess()
    if (refreshed) {
      headers["Authorization"] =
        `Bearer ${accessToken}`
      res = await fetch(path, { ...opts, headers })
    }
  }

  if (res.status === 401) {
    onAuthExpired?.()
    throw new ApiError(401, "Session expired")
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const msg =
      body.error || body.message || res.statusText
    throw new ApiError(res.status, msg)
  }

  // Best-effort flush whenever a mutation succeeds; any
  // queued peers ride on the same online window.
  if (queueable) flushQueue()

  if (res.status === 204) return undefined as T
  return res.json()
}

configureQueue(async (req) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`
  }
  return fetch(req.path, {
    method: req.method,
    headers,
    body: req.body
      ? JSON.stringify(req.body) : undefined,
  })
})

// -- Auth --

export function signup(
  email: string,
  password: string,
): Promise<SignupResult> {
  return request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
}

export function login(
  email: string,
  password: string,
): Promise<User> {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
}

export function forgotPassword(
  email: string,
): Promise<{ message: string }> {
  return request("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  })
}

export function resetPassword(
  token: string,
  password: string,
): Promise<{ message: string }> {
  return request("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  })
}

export function regenerateApiKey(): Promise<{
  api_key: string
}> {
  return request("/auth/api-key", { method: "POST" })
}

export function getMe(): Promise<{
  user_id: string
  email: string
  plan: string
}> {
  return request("/auth/me")
}

// -- Clocks --

export function getActive(): Promise<ActiveTimer> {
  return request("/clocks/active")
}

export function startTimer(data: {
  customer?: string
  description: string
  task_id?: string
  contract?: string
}): Promise<ActiveTimer> {
  return request("/clocks/start", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export function stopTimer(): Promise<ClockEntry> {
  return request("/clocks/stop", { method: "POST" })
}

export function quickBook(data: {
  duration: string
  customer?: string
  description: string
  date?: string
}): Promise<ClockEntry> {
  return request("/clocks/quick-book", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export function getEntries(
  params: {
    period?: "today" | "week" | "month" | "year"
    from?: string
    to?: string
  } = {},
): Promise<ClockEntry[]> {
  const qs = new URLSearchParams()
  if (params.from) qs.set("from", params.from)
  if (params.to) qs.set("to", params.to)
  if (!params.from && !params.to) {
    qs.set("period", params.period ?? "week")
  }
  return request(`/clocks/entries?${qs}`)
}

export function updateEntry(
  id: string,
  fields: {
    customer?: string | null
    description?: string
    task_id?: string | null
    contract?: string | null
    notes?: string
    invoiced?: boolean
    start_at?: string
    end_at?: string
  },
): Promise<ClockEntry> {
  return request(
    `/clocks/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(fields),
    },
  )
}

export async function deleteEntry(id: string): Promise<void> {
  await request(`/clocks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

// -- Reference data --

export function getCustomers(): Promise<Customer[]> {
  return request("/ref/customers")
}

export function getTasks(): Promise<TaskRef[]> {
  return request("/ref/tasks")
}

export interface AppConfig {
  tags: { name: string; color: string }[]
  github_configured: boolean
  avatar_seed?: string
  user_name?: string
}

export function getAppConfig(): Promise<AppConfig> {
  return request<AppConfig>("/ref/config")
}

export function updateAppConfig(
  updates: Partial<AppConfig>,
): Promise<AppConfig> {
  return request<AppConfig>("/ref/config", {
    method: "PATCH",
    body: JSON.stringify(updates),
  })
}

// -- Billing --

export function getSubscription(): Promise<{
  plan: string
  subscription?: {
    current_period_end: number
    cancel_at_period_end: boolean
    status: string
  } | null
}> {
  return request("/billing/subscription")
}

export function createCheckout(
  plan: "sync" | "sync_ai",
): Promise<{ url?: string; success?: boolean; plan?: string }> {
  return request("/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ plan }),
  })
}

export function createPortalSession(): Promise<{
  url: string
}> {
  return request("/billing/portal", {
    method: "POST",
  })
}

// -- AI --

const AI_TOOLS = [
  {
    type: "function",
    function: {
      name: "add_task",
      description:
        "Create a new task. Use when the user asks "
        + "to add, create, or track a task.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Task title",
          },
          customer: {
            type: "string",
            description: "Customer name (optional)",
          },
          status: {
            type: "string",
            enum: [
              "TODO", "NEXT", "IN-PROGRESS",
              "WAIT", "DONE", "CANCELLED",
            ],
            description: "Initial status",
          },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_inbox_item",
      description:
        "Add an item to the inbox. Use for ideas, "
        + "notes, leads, or anything to triage later.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Item title",
          },
          type: {
            type: "string",
            enum: [
              "NOTE", "IDEA", "EMAIL", "LEAD",
            ],
            description: "Item type",
          },
          customer: {
            type: "string",
            description: "Customer name (optional)",
          },
          body: {
            type: "string",
            description: "Body text (optional)",
          },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_note",
      description:
        "Create a note. Use for meeting notes, "
        + "documentation, or longer-form content.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Note title",
          },
          body: {
            type: "string",
            description: "Note body (markdown)",
          },
          customer: {
            type: "string",
            description: "Customer name (optional)",
          },
        },
        required: ["title"],
      },
    },
  },
]

interface AiToolCall {
  id: string
  function: { name: string; arguments: string }
}

interface AiResponse {
  text: string
  tool_calls: AiToolCall[] | null
  finish_reason: string
}

async function executeAiTool(
  name: string,
  args: Record<string, string>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case "add_task":
      await addSyncedTask({
        title: args.title,
        customer: args.customer,
        status: args.status,
      })
      return { ok: true, created: "task" }
    case "add_inbox_item":
      await addInboxItem({
        title: args.title,
        type: args.type,
        customer: args.customer,
        body: args.body,
      })
      return { ok: true, created: "inbox_item" }
    case "add_note":
      await addSyncedNote({
        title: args.title,
        body: args.body,
        customer: args.customer,
      })
      return { ok: true, created: "note" }
    default:
      return { error: `unknown tool: ${name}` }
  }
}

const MAX_AI_TURNS = 5

export async function aiComplete(
  system: string,
  messages: { role: string; content: string }[],
): Promise<string> {
  const msgs = [...messages]

  for (let i = 0; i < MAX_AI_TURNS; i++) {
    const data = await request<AiResponse>(
      "/ai/complete",
      {
        method: "POST",
        body: JSON.stringify({
          system,
          messages: msgs,
          tools: AI_TOOLS,
          max_tokens: 4096,
        }),
      },
    )

    const calls = data.tool_calls
    if (!calls || calls.length === 0) {
      return data.text || ""
    }

    // Append assistant message with tool calls
    msgs.push({
      role: "assistant",
      content: data.text || "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tool_calls: calls as any,
    } as any) // eslint-disable-line

    // Execute each tool and append results
    for (const call of calls) {
      let args: Record<string, string> = {}
      try {
        args = JSON.parse(
          call.function.arguments || "{}",
        )
      } catch {
        // ignore
      }
      const result = await executeAiTool(
        call.function.name, args,
      )
      msgs.push({
        role: "tool",
        content: JSON.stringify(result),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tool_call_id: call.id,
      } as any) // eslint-disable-line
    }
  }

  return msgs
    .filter((m) => m.role === "assistant")
    .map((m) => m.content)
    .pop() || ""
}

export function aiParseBooking(
  text: string,
): Promise<{
  parsed: {
    duration: string | null
    customer: string | null
    description: string
    date: string | null
  }
  source: "regex" | "ai"
}> {
  return request("/ai/parse-booking", {
    method: "POST",
    body: JSON.stringify({ text }),
  })
}

export function aiSummarize(
  entries: ClockEntry[],
): Promise<{ summary: string }> {
  return request("/ai/summarize", {
    method: "POST",
    body: JSON.stringify({ entries }),
  })
}

export function aiUsage(): Promise<{
  month: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  request_count: number
  cap: number
}> {
  return request("/ai/usage")
}

// -- Inbox --

export function getInboxItems(): Promise<InboxItem[]> {
  return request<{ entries: InboxItem[] }>(
    "/sync/inbox/changes?since=1970-01-01T00:00:00Z"
      + "&limit=500",
  ).then((d) =>
    (d.entries || []).filter((e) => !e.deleted_at)
  )
}

export function addInboxItem(data: {
  title: string
  type?: string
  customer?: string
  body?: string
}): Promise<{ inserted: number }> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  return request("/sync/inbox/apply", {
    method: "POST",
    body: JSON.stringify({
      entries: [{
        id,
        type: data.type || "NOTE",
        customer: data.customer || "",
        title: data.title,
        body: data.body || "",
        channel: "",
        direction: "in",
        created_at: now,
        updated_at: now,
      }],
    }),
  })
}

export function updateInboxItem(
  item: InboxItem,
  updates: Partial<InboxItem>,
): Promise<{ updated: number }> {
  const now = new Date().toISOString()
  return request("/sync/inbox/apply", {
    method: "POST",
    body: JSON.stringify({
      entries: [{
        ...item,
        ...updates,
        updated_at: now,
      }],
    }),
  })
}

export function deleteInboxItem(
  item: InboxItem,
): Promise<{ updated: number }> {
  const now = new Date().toISOString()
  return request("/sync/inbox/apply", {
    method: "POST",
    body: JSON.stringify({
      entries: [{
        ...item,
        deleted_at: now,
        updated_at: now,
      }],
    }),
  })
}

// -- Tasks --

export function getSyncedTasks(): Promise<Task[]> {
  return request<{ entries: Task[] }>(
    "/sync/tasks/changes?since=1970-01-01T00:00:00Z"
      + "&limit=500",
  ).then((d) =>
    (d.entries || []).filter((e) => !e.deleted_at)
  )
}

export function addSyncedTask(data: {
  title: string
  customer?: string
  status?: string
}): Promise<{ inserted: number }> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  return request("/sync/tasks/apply", {
    method: "POST",
    body: JSON.stringify({
      entries: [{
        id,
        customer: data.customer || "",
        title: data.title,
        status: data.status || "TODO",
        tags: [],
        body: "",
        github_url: "",
        created_at: now,
        updated_at: now,
      }],
    }),
  })
}

export function updateSyncedTask(
  task: Task,
  updates: Partial<Task>,
): Promise<{ updated: number }> {
  const now = new Date().toISOString()
  return request("/sync/tasks/apply", {
    method: "POST",
    body: JSON.stringify({
      entries: [{
        ...task,
        ...updates,
        updated_at: now,
      }],
    }),
  })
}

// -- Notes --

export function getSyncedNotes(): Promise<Note[]> {
  return request<{ entries: Note[] }>(
    "/sync/notes/changes?since=1970-01-01T00:00:00Z"
      + "&limit=500",
  ).then((d) =>
    (d.entries || []).filter((e) => !e.deleted_at)
  )
}

export function addSyncedNote(data: {
  title: string
  customer?: string
  body?: string
}): Promise<{ inserted: number }> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  return request("/sync/notes/apply", {
    method: "POST",
    body: JSON.stringify({
      entries: [{
        id,
        customer: data.customer || "",
        title: data.title,
        body: data.body || "",
        tags: [],
        task_id: null,
        created_at: now,
        updated_at: now,
      }],
    }),
  })
}

export function updateSyncedNote(
  note: Note,
  updates: Partial<Note>,
): Promise<{ updated: number }> {
  const now = new Date().toISOString()
  return request("/sync/notes/apply", {
    method: "POST",
    body: JSON.stringify({
      entries: [{
        ...note,
        ...updates,
        updated_at: now,
      }],
    }),
  })
}

export function deleteSyncedNote(
  note: Note,
): Promise<{ updated: number }> {
  const now = new Date().toISOString()
  return request("/sync/notes/apply", {
    method: "POST",
    body: JSON.stringify({
      entries: [{
        ...note,
        deleted_at: now,
        updated_at: now,
      }],
    }),
  })
}
