import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { ClockEntry } from "../types"
import { ApiError, aiSummarize, getEntries } from "../api"
import { useAuth } from "../auth"
import { ErrorBanner } from "./ErrorBanner"
import { formatMins } from "../utils/time"
import { isPaidPlan } from "../utils/planLabel"

// ── Formatters ──────────────────────────────────────────

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function startOfWeek(d: Date): Date {
  const out = startOfDay(d)
  const dow = out.getDay()
  out.setDate(out.getDate() - ((dow + 6) % 7))
  return out
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

function dowLabel(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
  }).slice(0, 2)
}

// ── Aggregators ─────────────────────────────────────────

function totalMinutes(entries: ClockEntry[]): number {
  return entries.reduce(
    (sum, e) => sum + (e.duration_minutes ?? 0), 0,
  )
}

function filterSince(
  entries: ClockEntry[], from: Date,
): ClockEntry[] {
  return entries.filter(
    (e) => new Date(e.start) >= from,
  )
}

interface DayBucket {
  date: Date
  label: string
  minutes: number
}

function buildWeekBuckets(
  entries: ClockEntry[], weekStart: Date,
): DayBucket[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStart, i)
    const next = addDays(day, 1)
    const mins = entries
      .filter((e) => {
        const t = new Date(e.start)
        return t >= day && t < next
      })
      .reduce(
        (s, e) => s + (e.duration_minutes ?? 0), 0,
      )
    return {
      date: day,
      label: dowLabel(day),
      minutes: mins,
    }
  })
}

interface CustomerBucket {
  name: string
  minutes: number
}

function topCustomers(
  entries: ClockEntry[], n = 3,
): CustomerBucket[] {
  const totals = new Map<string, number>()
  for (const e of entries) {
    const name = e.customer || "(unassigned)"
    totals.set(
      name,
      (totals.get(name) ?? 0) +
        (e.duration_minutes ?? 0),
    )
  }
  return [...totals.entries()]
    .map(([name, minutes]) => ({ name, minutes }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, n)
}

// ── Bar chart ───────────────────────────────────────────

interface BarChartProps {
  buckets: DayBucket[]
  onPick: (d: Date) => void
}

function BarChart({ buckets, onPick }: BarChartProps) {
  const max = Math.max(1, ...buckets.map((b) => b.minutes))
  const today = startOfDay(new Date()).getTime()
  return (
    <div className="bar-chart">
      {buckets.map((b) => {
        const pct = (b.minutes / max) * 100
        const isToday =
          startOfDay(b.date).getTime() === today
        return (
          <button
            type="button"
            key={b.date.toISOString()}
            className="bar-col"
            onClick={() => onPick(b.date)}
            aria-label={`${b.label} ${
              formatMins(b.minutes)
            }`}
          >
            <div className="bar-value">
              {b.minutes > 0 ? formatMins(b.minutes) : ""}
            </div>
            <div className="bar-track">
              <div
                className={
                  "bar-fill" +
                  (isToday ? " bar-fill--today" : "")
                }
                style={{ height: `${pct}%` }}
              />
            </div>
            <div
              className={
                "bar-label" +
                (isToday ? " bar-label--today" : "")
              }
            >
              {b.label}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── Dispatch event to entries view ──────────────────────

function openEntriesAt(from: Date, to?: Date) {
  const detail = {
    from: from.toISOString(),
    to: to ? to.toISOString() : undefined,
  }
  window.dispatchEvent(
    new CustomEvent("navigate-dashboard-drilldown", {
      detail,
    }),
  )
}

// ── Main view ───────────────────────────────────────────

export function DashboardView() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [entries, setEntries] = useState<ClockEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(
    null,
  )
  const [summaryLoading, setSummaryLoading] = useState(
    false,
  )
  const hasAI = isPaidPlan(user?.plan)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const out = await getEntries({ period: "month" })
      setEntries(out)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const now = new Date()
  const todayStart = startOfDay(now)
  const weekStart = startOfWeek(now)
  const monthStart = startOfMonth(now)

  const today = filterSince(entries, todayStart)
  const week = filterSince(entries, weekStart)
  const month = entries

  const todayMin = totalMinutes(today)
  const weekMin = totalMinutes(week)
  const monthMin = totalMinutes(month)

  const buckets = buildWeekBuckets(week, weekStart)
  const weekTop = topCustomers(week)
  const monthTop = topCustomers(month)

  return (
    <div className="view">
      <ErrorBanner
        message={error}
        onDismiss={() => setError(null)}
      />

      <div className="card dashboard-totals">
        <button
          type="button"
          className="dashboard-total"
          onClick={() => openEntriesAt(todayStart)}
        >
          <div className="dashboard-total-label">
            {t("dashboard.today")}
          </div>
          <div className="dashboard-total-value">
            {formatMins(todayMin)}
          </div>
        </button>
        <button
          type="button"
          className="dashboard-total"
          onClick={() => openEntriesAt(weekStart)}
        >
          <div className="dashboard-total-label">
            {t("dashboard.week")}
          </div>
          <div className="dashboard-total-value">
            {formatMins(weekMin)}
          </div>
        </button>
        <button
          type="button"
          className="dashboard-total"
          onClick={() => openEntriesAt(monthStart)}
        >
          <div className="dashboard-total-label">
            {t("dashboard.month")}
          </div>
          <div className="dashboard-total-value">
            {formatMins(monthMin)}
          </div>
        </button>
      </div>

      {/* AI Summary — any paid plan */}
      {hasAI && (
        <section className="card dashboard-section">
          <header className="dashboard-section-header">
            <h3>{t("dashboard.ai_summary")}</h3>
            <button
              type="button"
              className="link-btn"
              onClick={async () => {
                setSummaryLoading(true)
                try {
                  const { summary: text } =
                    await aiSummarize(week)
                  setSummary(text)
                } catch {
                  setSummary(
                    t("dashboard.summary_failed"),
                  )
                } finally {
                  setSummaryLoading(false)
                }
              }}
              disabled={summaryLoading}
            >
              {summaryLoading
                ? t("dashboard.generating")
                : summary
                  ? t("dashboard.refresh")
                  : t("dashboard.generate")}
            </button>
          </header>
          {summary && (
            <p className="dashboard-summary">
              {summary}
            </p>
          )}
          {!summary && !summaryLoading && (
            <p className="text-muted">
              {t("dashboard.summary_hint")}
            </p>
          )}
        </section>
      )}

      <section className="card dashboard-section">
        <header className="dashboard-section-header">
          <h3>{t("dashboard.this_week")}</h3>
          <span className="text-muted">
            {t("dashboard.drill_hint")}
          </span>
        </header>
        <BarChart
          buckets={buckets}
          onPick={(day) =>
            openEntriesAt(day, addDays(day, 1))
          }
        />
      </section>

      <section className="card dashboard-section">
        <header className="dashboard-section-header">
          <h3>{t("dashboard.top_customers_week")}</h3>
        </header>
        <CustomerList
          data={weekTop}
          total={weekMin}
          onPick={(name) =>
            window.dispatchEvent(
              new CustomEvent(
                "navigate-dashboard-customer",
                { detail: { customer: name } },
              ),
            )
          }
        />
      </section>

      <section className="card dashboard-section">
        <header className="dashboard-section-header">
          <h3>{t("dashboard.top_customers_month")}</h3>
        </header>
        <CustomerList
          data={monthTop}
          total={monthMin}
          onPick={(name) =>
            window.dispatchEvent(
              new CustomEvent(
                "navigate-dashboard-customer",
                { detail: { customer: name } },
              ),
            )
          }
        />
      </section>

      {loading && entries.length === 0 && (
        <p className="text-muted center">
          {t("dashboard.loading")}
        </p>
      )}
    </div>
  )
}

interface CustomerListProps {
  data: CustomerBucket[]
  total: number
  onPick: (name: string) => void
}

function CustomerList(props: CustomerListProps) {
  const { t } = useTranslation()
  if (props.data.length === 0) {
    return (
      <p className="text-muted center">
        {t("dashboard.no_entries")}
      </p>
    )
  }
  return (
    <ul className="customer-totals">
      {props.data.map((c) => {
        const pct = props.total > 0
          ? Math.round((c.minutes / props.total) * 100)
          : 0
        return (
          <li
            key={c.name}
            className="customer-totals-row"
            onClick={() => props.onPick(c.name)}
          >
            <div className="customer-totals-name">
              {c.name}
            </div>
            <div className="customer-totals-bar-track">
              <div
                className="customer-totals-bar-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="customer-totals-value">
              {formatMins(c.minutes)}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
