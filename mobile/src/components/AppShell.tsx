import { useState } from "react"
import { TimerView } from "./TimerView"
import { BookView } from "./BookView"
import { EntriesView } from "./EntriesView"
import { ProfileView } from "./ProfileView"

type Tab = "timer" | "book" | "entries" | "profile"

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "timer", label: "Timer", icon: "play" },
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
    default:
      return null
  }
}

export function AppShell() {
  const [tab, setTab] = useState<Tab>("timer")

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header-title">Kaisho</span>
      </header>
      <main className="app-content">
        {tab === "timer" && <TimerView />}
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
