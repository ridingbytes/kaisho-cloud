import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import type { ClockEntry } from "../types"
import { deleteEntry, getEntries, ApiError } from "../api"
import { ErrorBanner } from "./ErrorBanner"

type Range = "day" | "week" | "month"

// ── Formatters ──────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

function isoDate(d: Date): string {
  return (
    d.getFullYear() + "-" +
    pad(d.getMonth() + 1) + "-" +
    pad(d.getDate())
  )
}

function formatMins(m: number | null): string {
  if (m === null) return "—"
  const h = Math.floor(m / 60)
  const min = m % 60
  if (h === 0) return `${min}m`
  if (min === 0) return `${h}h`
  return `${h}h ${min}m`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

function formatTime(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })
}

// ── Range helpers ───────────────────────────────────────

/**
 * Return [from, to] ISO dates (inclusive start, exclusive
 * next day) for the given anchor date + range mode.
 */
function rangeBounds(
  anchor: Date, range: Range,
): { from: string; to: string; label: string } {
  if (range === "day") {
    const from = new Date(anchor)
    from.setHours(0, 0, 0, 0)
    const to = new Date(from)
    to.setDate(to.getDate() + 1)
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      label: anchor.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    }
  }
  if (range === "week") {
    const from = new Date(anchor)
    const day = from.getDay()
    from.setDate(from.getDate() - ((day + 6) % 7))
    from.setHours(0, 0, 0, 0)
    const to = new Date(from)
    to.setDate(to.getDate() + 7)
    const end = new Date(to)
    end.setDate(end.getDate() - 1)
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      label: `${isoDate(from)} – ${isoDate(end)}`,
    }
  }
  const from = new Date(
    anchor.getFullYear(), anchor.getMonth(), 1,
  )
  const to = new Date(
    anchor.getFullYear(), anchor.getMonth() + 1, 1,
  )
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    label: anchor.toLocaleDateString(undefined, {
      month: "long", year: "numeric",
    }),
  }
}

function shiftAnchor(
  anchor: Date, range: Range, delta: -1 | 1,
): Date {
  const next = new Date(anchor)
  if (range === "day") {
    next.setDate(next.getDate() + delta)
  } else if (range === "week") {
    next.setDate(next.getDate() + delta * 7)
  } else {
    next.setMonth(next.getMonth() + delta)
  }
  return next
}

// ── Range nav bar ───────────────────────────────────────

interface NavBarProps {
  range: Range
  anchor: Date
  onRange: (r: Range) => void
  onShift: (delta: -1 | 1) => void
  onReset: () => void
  label: string
  showReset: boolean
}

function NavBar(props: NavBarProps) {
  return (
    <div className="entries-nav">
      <div className="segmented">
        {(["day", "week", "month"] as Range[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => props.onRange(r)}
            className={
              "segmented-btn" +
              (props.range === r
                ? " segmented-btn--active"
                : "")
            }
          >
            {r.charAt(0).toUpperCase() + r.slice(1)}
          </button>
        ))}
      </div>
      <div className="entries-nav-row">
        <button
          type="button"
          className="btn-icon"
          onClick={() => props.onShift(-1)}
          aria-label="Previous"
        >
          {"<"}
        </button>
        <div className="entries-nav-label">
          {props.label}
        </div>
        <button
          type="button"
          className="btn-icon"
          onClick={() => props.onShift(1)}
          aria-label="Next"
        >
          {">"}
        </button>
        {props.showReset && (
          <button
            type="button"
            className="link-btn"
            onClick={props.onReset}
          >
            Today
          </button>
        )}
      </div>
    </div>
  )
}

// ── Day grouping ────────────────────────────────────────

function groupByDay(
  entries: ClockEntry[],
): { day: string; entries: ClockEntry[] }[] {
  const map = new Map<string, ClockEntry[]>()
  for (const e of entries) {
    const d = e.start.slice(0, 10)
    if (!map.has(d)) map.set(d, [])
    map.get(d)!.push(e)
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, entries]) => ({ day, entries }))
}

function sumMinutes(entries: ClockEntry[]): number {
  return entries.reduce(
    (s, e) => s + (e.duration_minutes ?? 0), 0,
  )
}

// ── Main view ───────────────────────────────────────────

export function EntriesView() {
  const [range, setRange] = useState<Range>(
    () =>
      (localStorage.getItem("entries_range") as Range) ||
      "week",
  )
  const [anchor, setAnchor] = useState<Date>(new Date())
  const [entries, setEntries] = useState<ClockEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] =
    useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem("entries_range", range)
  }, [range])

  // React to drilldown navigation from the Dashboard:
  // point the view at the picked day / range.
  useEffect(() => {
    function onDrill(event: Event) {
      const detail = (
        event as CustomEvent<{
          from: string
          to?: string
        }>
      ).detail
      const fromDate = new Date(detail.from)
      setAnchor(fromDate)
      if (detail.to) {
        const span =
          new Date(detail.to).getTime()
          - fromDate.getTime()
        const oneDay = 24 * 3600 * 1000
        setRange(span <= oneDay ? "day" : "week")
      } else {
        setRange("month")
      }
    }
    window.addEventListener(
      "navigate-dashboard-drilldown",
      onDrill as EventListener,
    )
    return () => {
      window.removeEventListener(
        "navigate-dashboard-drilldown",
        onDrill as EventListener,
      )
    }
  }, [])

  const bounds = useMemo(
    () => rangeBounds(anchor, range),
    [anchor, range],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const out = await getEntries({
        from: bounds.from, to: bounds.to,
      })
      setEntries(out)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }, [bounds.from, bounds.to])

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

  const totalMinutes = sumMinutes(entries)
  const groups = groupByDay(entries)
  const todayIso = isoDate(new Date())
  const anchorIso = isoDate(anchor)

  return (
    <div className="view">
      <NavBar
        range={range}
        anchor={anchor}
        onRange={setRange}
        onShift={(d) =>
          setAnchor((a) => shiftAnchor(a, range, d))
        }
        onReset={() => setAnchor(new Date())}
        label={bounds.label}
        showReset={anchorIso !== todayIso}
      />

      <ErrorBanner
        message={error}
        onDismiss={() => setError(null)}
      />

      <div className="entries-total">
        <span className="text-muted">Total</span>
        <span className="entries-total-value">
          {formatMins(totalMinutes || null)}
        </span>
      </div>

      {loading && entries.length === 0 && (
        <p className="text-muted center">Loading...</p>
      )}
      {!loading && entries.length === 0 && !error && (
        <p className="text-muted center">
          No entries in range
        </p>
      )}

      {groups.map(({ day, entries }) => (
        <section key={day} className="entries-day">
          <header className="entries-day-header">
            <span className="entry-date">
              {formatDate(day + "T00:00:00")}
            </span>
            <span className="entry-duration">
              {formatMins(sumMinutes(entries))}
            </span>
          </header>
          {entries.map((e) => (
            <div key={e.id} className="card entry-card">
              <div className="entry-header">
                <span className="entry-time">
                  {formatTime(e.start)}
                  {" – "}
                  {formatTime(e.end)}
                </span>
                <span className="entry-duration">
                  {formatMins(e.duration_minutes)}
                </span>
              </div>
              {e.customer && (
                <div className="entry-customer">
                  {e.customer}
                  {e.contract
                    ? ` / ${e.contract}` : ""}
                </div>
              )}
              {e.description && (
                <div className="entry-desc">
                  {e.description}
                </div>
              )}
              {e.invoiced && (
                <span
                  className={
                    "entry-tag entry-tag--invoiced"
                  }
                  title="Invoiced"
                >
                  Invoiced
                </span>
              )}
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
                     strokeWidth="2"
                     strokeLinecap="round"
                     strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
