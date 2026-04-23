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
  id?: string
  customer?: string | null
  description?: string
  task_id?: string | null
  contract?: string | null
  start?: string
  end?: string | null
  duration_minutes?: number | null
  notes?: string
  invoiced?: boolean
  updated_at?: string
}

export interface ClockEntry {
  id: string
  start: string
  end: string | null
  customer: string | null
  description: string
  duration_minutes: number | null
  task_id?: string | null
  contract?: string | null
  notes?: string
  invoiced?: boolean
  synced_at?: string | null
  created_at?: string
  updated_at?: string
}

export interface Customer {
  name: string
  contracts: { name: string }[]
}

export interface TaskRef {
  id: string
  customer: string
  title: string
  status: string
}

export interface Task extends TaskRef {
  tags: string[]
  body: string
  github_url: string
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export interface Note {
  id: string
  customer: string
  title: string
  body: string
  tags: string[]
  task_id: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export interface InboxItem {
  id: string
  type: string
  customer: string
  title: string
  body: string
  channel: string
  direction: string
  created_at: string
  updated_at: string
  deleted_at?: string | null
}
