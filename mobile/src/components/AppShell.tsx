import { useEffect, useState } from "react"
import { AdvisorView } from "./AdvisorView"
import { TimerView } from "./TimerView"
import { BookView } from "./BookView"
import { DashboardView } from "./DashboardView"
import { EntriesView } from "./EntriesView"
import { ProfileView } from "./ProfileView"
import { Logo } from "./Logo"

type Tab =
  | "timer"
  | "dashboard"
  | "book"
  | "advisor"
  | "entries"
  | "profile"

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "timer", label: "Timer", icon: "play" },
  { id: "dashboard", label: "Dashboard", icon: "chart" },
  { id: "book", label: "Book", icon: "plus" },
  { id: "advisor", label: "AI", icon: "ai" },
  { id: "entries", label: "Entries", icon: "list" },
  { id: "profile", label: "Profile", icon: "user" },
]

function TabIcon({ icon }: { icon: string }) {
  switch (icon) {
    case "play":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20"
          fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round">
          <polygon points="6,3 18,10 6,17" />
        </svg>
      )
    case "plus":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20"
          fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round">
          <line x1="10" y1="4" x2="10" y2="16" />
          <line x1="4" y1="10" x2="16" y2="10" />
        </svg>
      )
    case "list":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20"
          fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round">
          <line x1="5" y1="5" x2="17" y2="5" />
          <line x1="5" y1="10" x2="17" y2="10" />
          <line x1="5" y1="15" x2="17" y2="15" />
          <circle cx="2" cy="5" r="0.5"
            fill="currentColor" />
          <circle cx="2" cy="10" r="0.5"
            fill="currentColor" />
          <circle cx="2" cy="15" r="0.5"
            fill="currentColor" />
        </svg>
      )
    case "user":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20"
          fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round">
          <circle cx="10" cy="7" r="3" />
          <path d="M3 18c0-3.3 3.1-6 7-6s7 2.7 7 6" />
        </svg>
      )
    case "ai":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20"
          fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round">
          <circle cx="10" cy="10" r="7" />
          <circle cx="8" cy="8" r="1"
            fill="currentColor" />
          <circle cx="12" cy="8" r="1"
            fill="currentColor" />
          <path d="M7 12c1.5 1.5 4.5 1.5 6 0" />
        </svg>
      )
    case "chart":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20"
          fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round">
          <line x1="5" y1="16" x2="5" y2="10" />
          <line x1="10" y1="16" x2="10" y2="6" />
          <line x1="15" y1="16" x2="15" y2="12" />
        </svg>
      )
    default:
      return null
  }
}

const VALID_TABS = new Set<Tab>(
  TABS.map((t) => t.id),
)

function tabFromHash(): Tab {
  const hash = window.location.hash.replace("#", "")
  if (VALID_TABS.has(hash as Tab)) return hash as Tab
  return "timer"
}

export function AppShell() {
  const [tab, setTab] = useState<Tab>(() => {
    // After Stripe checkout, land on Profile so the user
    // can generate a connect key for the desktop app.
    const params = new URLSearchParams(
      window.location.search,
    )
    if (params.get("upgraded") === "true") {
      window.history.replaceState(
        {}, "", window.location.pathname + "#profile",
      )
      return "profile"
    }
    return tabFromHash()
  })

  // Persist tab in hash and listen for back/forward
  useEffect(() => {
    window.location.hash = tab
  }, [tab])

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener("hashchange", onHash)
    return () =>
      window.removeEventListener("hashchange", onHash)
  }, [])

  useEffect(() => {
    const goEntries = () => setTab("entries")
    const goTimer = () => setTab("timer")
    window.addEventListener(
      "navigate-dashboard-drilldown",
      goEntries as EventListener,
    )
    window.addEventListener(
      "navigate-dashboard-customer",
      goEntries as EventListener,
    )
    window.addEventListener(
      "resume-entry",
      goTimer as EventListener,
    )
    return () => {
      window.removeEventListener(
        "navigate-dashboard-drilldown",
        goEntries as EventListener,
      )
      window.removeEventListener(
        "navigate-dashboard-customer",
        goEntries as EventListener,
      )
      window.removeEventListener(
        "resume-entry",
        goTimer as EventListener,
      )
    }
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <Logo size={22} className="app-header-logo" />
        <span className="app-header-title">Kaisho</span>
      </header>
      <main className="app-content">
        {tab === "timer" && <TimerView />}
        {tab === "dashboard" && <DashboardView />}
        {tab === "book" && <BookView />}
        {tab === "advisor" && <AdvisorView />}
        {tab === "entries" && <EntriesView />}
        {tab === "profile" && <ProfileView />}
      </main>
      <nav className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={
              "tab-btn" +
              (tab === t.id ? " tab-active" : "")
            }
            onClick={() => setTab(t.id)}
          >
            <TabIcon icon={t.icon} />
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
