import { useCallback, useEffect, useRef, useState } from "react"
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

// ── Component ──────────────────────────────────────────

export function AdvisorView() {
  const { user } = useAuth()
  const hasAI = user?.plan === "sync_ai"

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    })
  }, [messages, loading])

  const send = useCallback(
    async (question: string) => {
      if (!question.trim() || loading) return
      setInput("")
      setError(null)
      setMessages((prev) => [
        ...prev,
        { role: "user", text: question },
      ])
      setLoading(true)

      try {
        const context = await buildContext()
        const prompt =
          "## Context\n\n" + context
          + "\n\n## Question\n\n" + question

        const result = await aiComplete(
          "You are the Kaisho AI advisor. Answer "
          + "based on the context provided. Be "
          + "concise and actionable.",
          [{ role: "user", content: prompt }],
        )
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: result },
        ])
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message)
        } else {
          setError("Request failed")
        }
      } finally {
        setLoading(false)
      }
    },
    [loading],
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    send(input)
  }

  if (!hasAI) {
    return (
      <div className="view advisor-view">
        <div className="advisor-upgrade">
          <p className="text-muted">
            The AI advisor requires the Sync + AI
            plan.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="view advisor-view">
      <ErrorBanner
        message={error}
        onDismiss={() => setError(null)}
      />

      <div className="advisor-messages">
        {messages.length === 0 && !loading && (
          <div className="advisor-welcome">
            <p className="advisor-welcome-title">
              Kaisho AI
            </p>
            <p className="text-muted">
              Ask about your time entries, tasks,
              and customers.
            </p>
            <div className="advisor-examples">
              {EXAMPLES.map((q, i) => (
                <button
                  key={i}
                  type="button"
                  className="advisor-example"
                  onClick={() => send(q)}
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
              Thinking...
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
          placeholder="Ask the advisor..."
          disabled={loading}
        />
        <button
          type="submit"
          className="btn-primary"
          disabled={loading || !input.trim()}
        >
          {loading ? "..." : "Send"}
        </button>
      </form>
    </div>
  )
}
