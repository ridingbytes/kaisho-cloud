/** Default task status when none is supplied on create.
 *  Mirrors ``DEFAULT_TASK_STATUS`` in ``api/config.js`` so
 *  the mobile client and the server agree without a
 *  round-trip. */
export const DEFAULT_TASK_STATUS = "TODO"

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
  project?: string | null
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
  project?: string | null
  contract?: string | null
  notes?: string
  invoiced?: boolean
  synced_at?: string | null
  created_at?: string
  updated_at?: string
}

/** Project lifecycle states, mirrored from the desktop. */
export const PROJECT_STATES = [
  "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED",
] as const

export type ProjectStatus =
  (typeof PROJECT_STATES)[number]

export interface Milestone {
  id: string
  title: string
  done: boolean
  due?: string | null
}

export interface Project {
  id: string
  name: string
  customer: string
  status: string
  contract?: string | null
  start?: string | null
  due?: string | null
  color: string
  tags: string[]
  description: string
  milestones: Milestone[]
  created_at?: string
  updated_at: string
  deleted_at?: string | null
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
  project?: string | null
  milestone?: string | null
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
  project?: string | null
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
