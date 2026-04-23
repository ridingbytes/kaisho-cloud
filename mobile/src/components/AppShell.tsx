import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { AdvisorView } from "./AdvisorView"
import { TimerView } from "./TimerView"
import { BookView } from "./BookView"
import { DashboardView } from "./DashboardView"
import { EntriesView } from "./EntriesView"
import { InboxView } from "./InboxView"
import { ProfileView } from "./ProfileView"
import { Logo } from "./Logo"
import { useAuth } from "../auth"
import { planLabel } from "../utils/planLabel"

type Tab =
  | "timer"
  | "dashboard"
  | "book"
  | "inbox"
  | "advisor"
  | "entries"
  | "profile"

const TABS: { id: Tab; icon: string }[] = [
  { id: "timer", icon: "play" },
  { id: "dashboard", icon: "chart" },
  { id: "inbox", icon: "inbox" },
  { id: "advisor", icon: "ai" },
  { id: "entries", icon: "list" },
  { id: "profile", icon: "user" },
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
    case "inbox":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20"
          fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round">
          <polyline points="3 10 3 17 17 17 17 10" />
          <path d="M3 10l3-7h8l3 7" />
          <line x1="3" y1="10" x2="8" y2="10" />
          <line x1="12" y1="10" x2="17" y2="10" />
          <path d="M8 10v1a2 2 0 004 0v-1" />
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
  const { t } = useTranslation()
  const { user } = useAuth()
  const isPaid = user?.plan === "sync"
    || user?.plan === "sync_ai"
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
        {isPaid && (
          <button
            className="header-plan-badge"
            onClick={() => setTab("profile")}
          >
            {planLabel(user!.plan)}
          </button>
        )}
      </header>
      <main className="app-content">
        {tab === "timer" && <TimerView />}
        {tab === "dashboard" && <DashboardView />}
        {tab === "book" && <BookView />}
        {tab === "inbox" && <InboxView />}
        {tab === "advisor" && <AdvisorView />}
        {tab === "entries" && <EntriesView />}
        {tab === "profile" && <ProfileView />}
      </main>
      <nav className="tab-bar">
        {TABS.map((tabItem) => (
          <button
            key={tabItem.id}
            className={
              "tab-btn" +
              (tab === tabItem.id ? " tab-active" : "")
            }
            onClick={() => setTab(tabItem.id)}
          >
            <TabIcon icon={tabItem.icon} />
            <span className="tab-label">
              {t(`shell.tab.${tabItem.id}`)}
            </span>
          </button>
        ))}
      </nav>
    </div>
  )
}
