import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { AdvisorView } from "./AdvisorView"
import { TimerView } from "./TimerView"
import { BookView } from "./BookView"
import { DashboardView } from "./DashboardView"
import { EntriesView } from "./EntriesView"
import { InboxView } from "./InboxView"
import { TasksView } from "./TasksView"
import { NotesView } from "./NotesView"
import { ProfileView } from "./ProfileView"
import { Logo } from "./Logo"
import { useAuth } from "../auth"
import { getAppConfig } from "../api"
import type { AppConfig } from "../api"
import { planLabel, isPaidPlan } from "../utils/planLabel"
import { PixelAvatar } from "./PixelAvatar"
import { PullToRefresh } from "./PullToRefresh"

type Tab =
  | "timer"
  | "tasks"
  | "inbox"
  | "advisor"
  | "notes"
  | "dashboard"
  | "book"
  | "entries"

type TabGroup = "time" | "organize"

interface TabDef {
  id: Tab
  icon: string
}

const TIME_TABS: TabDef[] = [
  { id: "timer", icon: "play" },
  { id: "entries", icon: "list" },
  { id: "book", icon: "plus" },
]

const ORGANIZE_TABS: TabDef[] = [
  { id: "tasks", icon: "check" },
  { id: "inbox", icon: "inbox" },
  { id: "notes", icon: "edit" },
  { id: "advisor", icon: "ai" },
]

const TIME_IDS = new Set(TIME_TABS.map((t) => t.id))

function groupForTab(tab: Tab): TabGroup {
  return TIME_IDS.has(tab) ? "time" : "organize"
}

const ALL_TAB_IDS = new Set<Tab>([
  ...TIME_TABS.map((t) => t.id),
  ...ORGANIZE_TABS.map((t) => t.id),
  "dashboard",
])

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
    case "check":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20"
          fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round">
          <rect x="3" y="3" width="14" height="14"
            rx="2" />
          <polyline points="7 10 9.5 12.5 13 7.5" />
        </svg>
      )
    case "edit":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20"
          fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round">
          <path d="M12 3l5 5-9 9H3v-5z" />
          <line x1="10" y1="5" x2="15" y2="10" />
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

function tabFromHash(): Tab | "profile" {
  const hash = window.location.hash.replace("#", "")
  if (hash === "profile") return "profile"
  if (ALL_TAB_IDS.has(hash as Tab)) return hash as Tab
  return "timer"
}

export function AppShell() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isPaid = isPaidPlan(user?.plan)
  const [profileOpen, setProfileOpen] = useState(false)
  const [tab, setTab] = useState<Tab>(() => {
    const params = new URLSearchParams(
      window.location.search,
    )
    if (params.get("upgraded") === "true") {
      window.history.replaceState(
        {}, "", window.location.pathname + "#timer",
      )
      // Open profile sheet after mount
      setTimeout(() => setProfileOpen(true), 0)
      return "timer"
    }
    const initial = tabFromHash()
    if (initial === "profile") {
      setTimeout(() => setProfileOpen(true), 0)
      return "timer"
    }
    return initial
  })

  const [appConfig, setAppConfig] =
    useState<AppConfig | null>(null)

  useEffect(() => {
    getAppConfig()
      .then(setAppConfig)
      .catch(() => {})
  }, [])

  const activeGroup = groupForTab(tab)
  const visibleTabs = activeGroup === "time"
    ? TIME_TABS
    : ORGANIZE_TABS

  const initials = (
    appConfig?.user_name || user?.email || ""
  )
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("")

  function switchGroup(group: TabGroup) {
    if (group === activeGroup) return
    const firstTab = group === "time"
      ? TIME_TABS[0].id
      : ORGANIZE_TABS[0].id
    setTab(firstTab)
  }

  // Persist tab in hash and listen for back/forward
  useEffect(() => {
    window.location.hash = tab
  }, [tab])

  useEffect(() => {
    const onHash = () => {
      const next = tabFromHash()
      if (next === "profile") {
        setProfileOpen(true)
      } else {
        setTab(next)
      }
    }
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
          <span className="header-plan-badge">
            {planLabel(user!.plan)}
          </span>
        )}
        {initials && (
          <span className="header-initials">
            {initials}
          </span>
        )}
        <button
          className="header-avatar-btn"
          onClick={() => setProfileOpen(true)}
          aria-label={t("shell.tab.profile")}
        >
          <PixelAvatar
            seed={
              appConfig?.avatar_seed || "kaisho"
            }
            style={appConfig?.avatar_style}
            size={24}
          />
        </button>
      </header>
      {/* Advisor manages its own scrolling region with
          long messages — wrapping it in PullToRefresh
          causes the outer handler to intercept upward
          touch gestures and reload the page, wiping the
          conversation. The advisor has nothing to refresh
          remotely anyway, so it's rendered outside. */}
      {tab === "advisor" ? (
        <div className="app-content">
          <AdvisorView />
        </div>
      ) : (
        <PullToRefresh className="app-content">
          {tab === "timer" && <TimerView />}
          {tab === "tasks" && <TasksView />}
          {tab === "inbox" && <InboxView />}
          {tab === "notes" && <NotesView />}
          {tab === "dashboard" && <DashboardView />}
          {tab === "book" && <BookView />}
          {tab === "entries" && <EntriesView />}
        </PullToRefresh>
      )}
      <div className="tab-group-switcher">
        <div className="segmented">
          <button
            type="button"
            className={
              "segmented-btn" +
              (activeGroup === "time"
                ? " segmented-btn--active" : "")
            }
            onClick={() => switchGroup("time")}
          >
            {t("shell.group.time")}
          </button>
          <button
            type="button"
            className={
              "segmented-btn" +
              (activeGroup === "organize"
                ? " segmented-btn--active" : "")
            }
            onClick={() => switchGroup("organize")}
          >
            {t("shell.group.organize")}
          </button>
        </div>
      </div>
      <nav className="tab-bar">
        {visibleTabs.map((tabItem) => (
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

      {profileOpen && (
        <div
          className="edit-sheet-backdrop"
          onClick={() => setProfileOpen(false)}
        >
          <div
            className="edit-sheet profile-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="edit-sheet-header">
              <h3>{t("shell.tab.profile")}</h3>
              <button
                className="edit-sheet-close"
                onClick={() => setProfileOpen(false)}
              >
                &times;
              </button>
            </div>
            <div className="edit-sheet-body">
              <ProfileView />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
