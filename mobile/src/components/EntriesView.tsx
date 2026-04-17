import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import type { ClockEntry, Customer } from "../types"
import {
  deleteEntry,
  getCustomers,
  getEntries,
  stopTimer,
  ApiError,
} from "../api"
import { useToast } from "../toast"
import { ErrorBanner } from "./ErrorBanner"
import { EditEntrySheet } from "./EditEntrySheet"

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

function formatElapsed(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime()
  const sec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return [h, m, s]
    .map((n) => String(n).padStart(2, "0"))
    .join(":")
}

function RunningElapsed({ start }: { start: string }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(
      () => setTick((n) => n + 1), 1000,
    )
    return () => clearInterval(id)
  }, [])
  return <>{formatElapsed(start)}</>
}

function isRunning(e: ClockEntry): boolean {
  return !e.end
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
  const { toast } = useToast()
  const [range, setRange] = useState<Range>(
    () =>
      (localStorage.getItem("entries_range") as Range) ||
      "week",
  )
  const [anchor, setAnchor] = useState<Date>(new Date())
  const [entries, setEntries] = useState<ClockEntry[]>([])
  const [customers, setCustomers] = useState<Customer[]>(
    [],
  )
  const [customerFilter, setCustomerFilter] =
    useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] =
    useState<string | null>(null)
  const [editingEntry, setEditingEntry] =
    useState<ClockEntry | null>(null)

  useEffect(() => {
    localStorage.setItem("entries_range", range)
  }, [range])

  // Load customer list for the filter dropdown.
  useEffect(() => {
    getCustomers()
      .then(setCustomers)
      .catch(() => {})
  }, [])

  // React to drilldown navigation from the Dashboard.
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
    function onCustomer(event: Event) {
      const detail = (
        event as CustomEvent<{ customer: string }>
      ).detail
      setCustomerFilter(detail.customer)
    }
    window.addEventListener(
      "navigate-dashboard-drilldown",
      onDrill as EventListener,
    )
    window.addEventListener(
      "navigate-dashboard-customer",
      onCustomer as EventListener,
    )
    return () => {
      window.removeEventListener(
        "navigate-dashboard-drilldown",
        onDrill as EventListener,
      )
      window.removeEventListener(
        "navigate-dashboard-customer",
        onCustomer as EventListener,
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

  const filtered = customerFilter
    ? entries.filter(
        (e) => e.customer === customerFilter,
      )
    : entries
  const totalMinutes = sumMinutes(filtered)
  const groups = groupByDay(filtered)
  const todayIso = isoDate(new Date())
  const anchorIso = isoDate(anchor)

  // Unique customers from loaded entries + ref list.
  const allCustomerNames = useMemo(() => {
    const names = new Set<string>()
    for (const e of entries) {
      if (e.customer) names.add(e.customer)
    }
    for (const c of customers) names.add(c.name)
    return [...names].sort()
  }, [entries, customers])

  // Check if any entry in the current list is running.
  const hasRunning = entries.some(isRunning)

  async function handleResume(e: ClockEntry) {
    if (hasRunning) {
      const ok = confirm(
        "A timer is running. Stop it and start a " +
        "new one?",
      )
      if (!ok) return
      try {
        await stopTimer()
        toast("Timer stopped")
      } catch {
        // If stop fails the start will also fail with
        // 409 — let the TimerView show the error.
      }
    }
    const detail = {
      customer: e.customer ?? "",
      description: e.description ?? "",
      task_id: e.task_id ?? "",
      contract: e.contract ?? "",
      autoStart: true,
    }
    window.dispatchEvent(
      new CustomEvent("resume-entry", { detail }),
    )
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("resume-entry", { detail }),
      )
    }, 50)
  }

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

      <div className="entries-filter-bar">
        <select
          value={customerFilter}
          onChange={(e) =>
            setCustomerFilter(e.target.value)
          }
          className="entries-filter-select"
        >
          <option value="">All customers</option>
          {allCustomerNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {customerFilter && (
          <button
            type="button"
            className="link-btn"
            onClick={() => setCustomerFilter("")}
          >
            Clear
          </button>
        )}
      </div>

      <ErrorBanner
        message={error}
        onDismiss={() => setError(null)}
      />

      <div className="entries-total">
        <span className="text-muted">
          {customerFilter
            ? `Total · ${customerFilter}`
            : "Total"}
        </span>
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
            <div
              key={e.id}
              className={
                "card entry-card entry-card--tap" +
                (isRunning(e)
                  ? " entry-card--running" : "")
              }
              onClick={() => setEditingEntry(e)}
            >
              <div className="entry-header">
                <span className="entry-time">
                  {formatTime(e.start)}
                  {" – "}
                  {isRunning(e) ? "now" : formatTime(e.end)}
                </span>
                <span className="entry-duration">
                  {isRunning(e)
                    ? <RunningElapsed start={e.start} />
                    : formatMins(e.duration_minutes)}
                </span>
              </div>
              {e.customer && (
                <div
                  className="entry-customer entry-customer--tap"
                  onClick={(ev) => {
                    ev.stopPropagation()
                    setCustomerFilter(e.customer!)
                  }}
                >
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
              <span
                className={
                  "sync-dot " +
                  (e.synced_at ? "synced" : "pending")
                }
                title={
                  e.synced_at
                    ? "Synced to local app"
                    : "Pending sync"
                }
              />
              <div
                className="entry-actions"
                onClick={(ev) => ev.stopPropagation()}
              >
                {!isRunning(e) && (
                  <button
                    className="entry-action-btn"
                    onClick={() => handleResume(e)}
                    aria-label="Resume"
                    title="Resume timer"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg"
                         viewBox="0 0 24 24"
                         width="15" height="15"
                         fill="none"
                         stroke="currentColor"
                         strokeWidth="2"
                         strokeLinecap="round"
                         strokeLinejoin="round">
                      <polygon
                        points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </button>
                )}
                <button
                  className="entry-action-btn
                    entry-action-btn--danger"
                  onClick={() => handleDelete(e)}
                  disabled={deletingId === e.id}
                  aria-label="Delete entry"
                  title="Delete entry"
                >
                  <svg xmlns="http://www.w3.org/2000/svg"
                       viewBox="0 0 24 24"
                       width="15" height="15"
                       fill="none"
                       stroke="currentColor"
                       strokeWidth="2"
                       strokeLinecap="round"
                       strokeLinejoin="round">
                    <polyline
                      points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0
                      0 1-2 2H8a2 2 0 0
                      1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 0
                      1 1-1h4a1 1 0 0
                      1 1 1v2"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </section>
      ))}

      {editingEntry && (
        <EditEntrySheet
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSaved={(updated) => {
            setEntries((prev) =>
              prev.map((e) =>
                e.id === updated.id ? updated : e,
              ),
            )
            setEditingEntry(null)
          }}
        />
      )}
    </div>
  )
}
