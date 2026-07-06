/**
 * Project display helpers: status metadata, the colour
 * palette used by the picker, and a stable default colour
 * derived from a project id (mirrors the desktop, which
 * auto-assigns a colour from the PROJECT_ID when none is
 * set on create).
 */

import type { Project } from "../types"

export interface StatusMeta {
  value: string
  color: string
}

/** Status → accent colour, in lifecycle order. */
export const PROJECT_STATUS_META: StatusMeta[] = [
  { value: "ACTIVE", color: "#22c55e" },
  { value: "ON_HOLD", color: "#f59e0b" },
  { value: "COMPLETED", color: "#6366f1" },
  { value: "ARCHIVED", color: "#9ca3af" },
]

export function statusColor(status: string): string {
  return (
    PROJECT_STATUS_META.find((s) => s.value === status)
      ?.color || "#9ca3af"
  )
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ").toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase())
}

/** Curated palette offered in the colour picker. */
export const PROJECT_PALETTE = [
  "#6366f1", "#3b82f6", "#06b6d4", "#22c55e",
  "#84cc16", "#eab308", "#f59e0b", "#f97316",
  "#ef4444", "#ec4899", "#a855f7", "#8b5cf6",
]

/**
 * Colour to render for a project: its own colour if set,
 * otherwise a deterministic pick from the palette keyed
 * off the id so the same project is always the same hue.
 */
export function projectColor(project: {
  id: string
  color?: string
}): string {
  if (project.color) return project.color
  let hash = 0
  for (const ch of project.id) {
    hash = (hash * 31 + ch.charCodeAt(0)) | 0
  }
  const idx = Math.abs(hash) % PROJECT_PALETTE.length
  return PROJECT_PALETTE[idx]
}

/** Completed-milestone ratio, 0..1 (0 when none). */
export function milestoneProgress(project: Project): number {
  const ms = project.milestones || []
  if (ms.length === 0) return 0
  const done = ms.filter((m) => m.done).length
  return done / ms.length
}

/** Sort key: active first, then by most recent update. */
export function projectSortKey(p: Project): string {
  const rank =
    PROJECT_STATUS_META.findIndex(
      (s) => s.value === p.status,
    )
  const r = rank < 0 ? 9 : rank
  return `${r}-${p.updated_at}`
}
