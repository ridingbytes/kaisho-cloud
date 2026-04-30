import {
  useCallback, useEffect, useRef, useState,
} from "react"
import { useTranslation } from "react-i18next"
import { Markdown } from "./Markdown"
import {
  aiComplete,
  getEntries,
  getCustomers,
  getTasks,
  ApiError,
} from "../api"
import { useAuth } from "../auth"
import { ErrorBanner } from "./ErrorBanner"
import { useConfirm } from "./ConfirmDialog"

// ── Example prompts ────────────────────────────────────

const EXAMPLES = [
  "How many hours did I work today?",
  "Which customer took the most time this week?",
  "Summarize my week",
  "What tasks are still open?",
  "Am I close to any budget limit?",
]

// ── Context builder ────────────────────────────────────

async function buildContext(): Promise<string> {
  const [entries, customers, tasks] = await Promise.all([
    getEntries({ period: "month" }).catch(() => []),
    getCustomers().catch(() => []),
    getTasks().catch(() => []),
  ])

  const lines: string[] = []

  if (entries.length > 0) {
    lines.push("## Clock Entries (this month)")
    for (const e of entries.slice(0, 30)) {
      const dur = e.duration_minutes
        ? `${Math.round(e.duration_minutes)}m`
        : "running"
      lines.push(
        `- ${e.start?.slice(0, 10)} `
        + `[${e.customer || "?"}] `
        + `${e.description || ""} (${dur})`,
      )
    }
    if (entries.length > 30) {
      lines.push(`- ... ${entries.length - 30} more`)
    }
  }

  if (customers.length > 0) {
    lines.push("\n## Customers")
    for (const c of customers) {
      lines.push(`- ${c.name}`)
    }
  }

  if (tasks.length > 0) {
    lines.push("\n## Tasks")
    for (const t of tasks) {
      const cust = t.customer ? `[${t.customer}] ` : ""
      lines.push(`- ${cust}${t.title}`)
    }
  }

  return lines.join("\n")
}

// ── Types ──────────────────────────────────────────────

interface Message {
  role: "user" | "assistant"
  text: string
}

// ── Conversation persistence ───────────────────────────

// localStorage key — bump when changing the Message
// shape so old entries don't deserialize incorrectly.
const STORAGE_KEY = "kaisho.advisor.messages.v1"

// Cap the conversation history sent to the gateway so a
// single long-running thread doesn't blow through the
// monthly token budget. The user still sees all prior
// messages locally; only the last N are forwarded.
const MAX_HISTORY_MESSAGES = 20

function loadStoredMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (m): m is Message =>
        m && typeof m.text === "string"
        && (m.role === "user" || m.role === "assistant"),
    )
  } catch {
    return []
  }
}

function saveMessages(messages: Message[]) {
  try {
    localStorage.setItem(
      STORAGE_KEY, JSON.stringify(messages),
    )
  } catch {
    // Storage may be full or disabled (private mode).
    // Silently drop — the conversation still works in
    // memory; only persistence is lost.
  }
}

// ── Component ──────────────────────────────────────────

export function AdvisorView() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const hasAI = user?.plan === "sync_ai"

  const [messages, setMessages] = useState<Message[]>(
    loadStoredMessages,
  )
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [confirm, confirmDialog] = useConfirm()

  useEffect(() => {
    saveMessages(messages)
  }, [messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    })
  }, [messages, loading])

  function stopRequest() {
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
  }

  const send = useCallback(
    async (question: string) => {
      if (!question.trim() || loading) return
      setInput("")
      setError(null)

      // Snapshot prior history before adding the new
      // user turn — this is what gets forwarded to the
      // gateway as conversation context.
      const priorMessages = messages.slice(
        -MAX_HISTORY_MESSAGES,
      )

      setMessages((prev) => [
        ...prev,
        { role: "user", text: question },
      ])
      setLoading(true)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const context = await buildContext()

        // Send full prior conversation + the new turn.
        // Context (clock entries, tasks, etc.) is
        // injected only on the latest user message so
        // the gateway sees a fresh snapshot each turn
        // without re-paying for it on earlier turns.
        const wireMessages = [
          ...priorMessages.map((m) => ({
            role: m.role,
            content: m.text,
          })),
          {
            role: "user",
            content:
              "## Context\n\n" + context
              + "\n\n## Question\n\n" + question,
          },
        ]

        const result = await aiComplete(
          "You are the Kaisho AI advisor. Answer "
          + "based on the context provided and any "
          + "earlier turns in this conversation. Be "
          + "concise and actionable.",
          wireMessages,
        )
        if (!controller.signal.aborted) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", text: result },
          ])
        }
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof ApiError) {
          setError(err.message)
        } else {
          setError(t("advisor.error_failed"))
        }
      } finally {
        abortRef.current = null
        setLoading(false)
      }
    },
    [loading, messages, t],
  )

  async function clearConversation() {
    if (loading) return
    const ok = await confirm(
      t("advisor.confirm_clear"),
    )
    if (!ok) return
    setMessages([])
    setError(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    send(input)
  }

  if (!hasAI) {
    return (
      <div className="view advisor-view">
        <div className="advisor-upgrade">
          <p className="text-muted">
            {t("advisor.upgrade_required")}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="view advisor-view">
      {confirmDialog}
      <ErrorBanner
        message={error}
        onDismiss={() => setError(null)}
      />

      {messages.length > 0 && (
        <div className="advisor-toolbar">
          <button
            type="button"
            className="advisor-clear-btn"
            onClick={clearConversation}
            disabled={loading}
            aria-label={t("advisor.clear")}
          >
            <svg
              width="14" height="14"
              viewBox="0 0 24 24"
              fill="none" stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            <span>{t("advisor.clear")}</span>
          </button>
        </div>
      )}

      <div className="advisor-messages">
        {messages.length === 0 && !loading && (
          <div className="advisor-welcome">
            <p className="advisor-welcome-title">
              {t("advisor.welcome_title")}
            </p>
            <p className="text-muted">
              {t("advisor.welcome_subtitle")}
            </p>
            <div className="advisor-examples">
              {EXAMPLES.map((q, i) => (
                <button
                  key={i}
                  type="button"
                  className="advisor-example"
                  onClick={() => setInput(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={
              "advisor-msg advisor-msg--"
              + msg.role
            }
          >
            <div className="advisor-msg-text">
              {msg.role === "assistant" ? (
                <Markdown>{msg.text}</Markdown>
              ) : (
                msg.text
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="advisor-msg advisor-msg--assistant">
            <div className="advisor-msg-text advisor-thinking">
              {t("advisor.thinking")}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="advisor-input"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("advisor.placeholder")}
          disabled={loading}
        />
        {loading ? (
          <button
            type="button"
            className="btn-stop"
            onClick={stopRequest}
          >
            {t("advisor.stop")}
          </button>
        ) : (
          <button
            type="submit"
            className="btn-primary"
            disabled={!input.trim()}
          >
            {t("advisor.send")}
          </button>
        )}
      </form>
    </div>
  )
}
