import { useCallback, useEffect, useState } from "react"
import type { ClockEntry } from "../types"
import { deleteEntry, getEntries, ApiError } from "../api"
import { ErrorBanner } from "./ErrorBanner"

function formatMins(m: number): string {
  const h = Math.floor(m / 60)
  const min = m % 60
  if (h === 0) return `${min}m`
  if (min === 0) return `${h}h`
  return `${h}h ${min}m`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function EntriesView() {
  const [entries, setEntries] = useState<ClockEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] =
    useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setEntries(await getEntries())
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      }
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleDelete(e: ClockEntry) {
    const label = e.description
      ? `"${e.description}"`
      : `${formatDate(e.start)} ${formatTime(e.start)}`
    if (!confirm(`Delete entry ${label}?`)) return
    setDeletingId(e.id)
    try {
      await deleteEntry(e.id)
      setEntries((prev) =>
        prev.filter((x) => x.id !== e.id),
      )
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      }
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="view">
      <ErrorBanner
        message={error}
        onDismiss={() => setError(null)}
      />
      {entries.length === 0 && !error && (
        <p className="text-muted center">
          No entries this week
        </p>
      )}
      {entries.map((e) => (
        <div key={e.id} className="card entry-card">
          <div className="entry-header">
            <span className="entry-date">
              {formatDate(e.start)}
            </span>
            <span className="entry-duration">
              {formatMins(e.duration_minutes)}
            </span>
          </div>
          <div className="entry-time">
            {formatTime(e.start)}
            {" - "}
            {formatTime(e.end)}
          </div>
          {e.customer && (
            <div className="entry-customer">
              {e.customer}
              {e.contract ? ` / ${e.contract}` : ""}
            </div>
          )}
          <div className="entry-desc">
            {e.description}
          </div>
          <span
            className={
              "sync-dot " +
              (e.synced ? "synced" : "unsynced")
            }
            title={e.synced ? "Synced" : "Not synced"}
          />
          <button
            className="entry-delete"
            onClick={() => handleDelete(e)}
            disabled={deletingId === e.id}
            aria-label="Delete entry"
            title="Delete entry"
          >
            <svg xmlns="http://www.w3.org/2000/svg"
                 viewBox="0 0 24 24"
                 width="16" height="16"
                 fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round"
                 stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
