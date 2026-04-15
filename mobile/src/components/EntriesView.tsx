import { useCallback, useEffect, useState } from "react"
import type { ClockEntry } from "../types"
import { getEntries, ApiError } from "../api"
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
      {entries.map((e, i) => (
        <div key={i} className="card entry-card">
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
        </div>
      ))}
    </div>
  )
}
