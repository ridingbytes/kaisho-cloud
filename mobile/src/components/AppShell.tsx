import { useEffect, useState } from "react"
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
  | "entries"
  | "profile"

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "timer", label: "Timer", icon: "play" },
  { id: "dashboard", label: "Dashboard", icon: "chart" },
  { id: "book", label: "Book", icon: "plus" },
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

export function AppShell() {
  const [tab, setTab] = useState<Tab>("timer")

  // Dashboard drilldowns navigate to the Entries tab.
  useEffect(() => {
    const goEntries = () => setTab("entries")
    window.addEventListener(
      "navigate-dashboard-drilldown",
      goEntries as EventListener,
    )
    window.addEventListener(
      "navigate-dashboard-customer",
      goEntries as EventListener,
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
