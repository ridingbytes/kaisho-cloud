import type {
  ActiveTimer,
  ClockEntry,
  Customer,
  SignupResult,
  Task,
  User,
} from "./types"

let accessToken: string | null = null
let refreshToken: string | null = null
let onAuthExpired: (() => void) | null = null
let onTokensRefreshed:
  | ((access: string, refresh: string) => void)
  | null = null

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

async function refreshAccess(): Promise<boolean> {
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

  let res = await fetch(path, { ...opts, headers })

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

  return res.json()
}

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

export function rotateKey(
  email: string,
): Promise<{ message: string }> {
  return request("/auth/rotate-key", {
    method: "POST",
    body: JSON.stringify({ email }),
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

export function getEntries(): Promise<ClockEntry[]> {
  return request("/clocks/entries?period=week")
}

// -- Reference data --

export function getCustomers(): Promise<Customer[]> {
  return request("/ref/customers")
}

export function getTasks(): Promise<Task[]> {
  return request("/ref/tasks")
}
