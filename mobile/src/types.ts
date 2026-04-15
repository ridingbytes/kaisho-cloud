export interface User {
  email: string
  plan: string
  access_token: string
  refresh_token: string
}

export interface SignupResult {
  user_id: string
  api_key: string
}

export interface ActiveTimer {
  active: boolean
  customer?: string
  description?: string
  task_id?: string
  contract?: string
  started_at?: string
}

export interface ClockEntry {
  start: string
  end: string
  customer: string
  description: string
  duration_minutes: number
  synced: boolean
  contract?: string
}

export interface Customer {
  name: string
  contracts: { name: string }[]
}

export interface Task {
  id: string
  title: string
  customer: string
}
