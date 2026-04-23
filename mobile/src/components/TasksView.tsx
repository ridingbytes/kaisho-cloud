import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  addSyncedTask,
  getSyncedTasks,
  updateSyncedTask,
} from "../api"
import type { Task } from "../types"

const STATUS_ORDER = [
  "TODO", "IN_PROGRESS", "REVIEW", "DONE",
]

function statusLabel(status: string): string {
  return status.replace("_", " ")
}

function StatusBadge({
  status,
  onClick,
}: {
  status: string
  onClick?: () => void
}) {
  const cls: Record<string, string> = {
    TODO: "task-status-todo",
    IN_PROGRESS: "task-status-progress",
    REVIEW: "task-status-review",
    DONE: "task-status-done",
  }
  return (
    <button
      className={"task-status-badge " + (cls[status] || "")}
      onClick={onClick}
    >
      {statusLabel(status)}
    </button>
  )
}

function TaskRow({
  task,
  onToggle,
}: {
  task: Task
  onToggle: (task: Task) => void
}) {
  return (
    <div className="task-row">
      <div className="task-row-left">
        <StatusBadge
          status={task.status}
          onClick={() => onToggle(task)}
        />
      </div>
      <div className="task-row-content">
        <p className="task-title">{task.title}</p>
        {task.customer && (
          <span className="task-customer">
            {task.customer}
          </span>
        )}
      </div>
    </div>
  )
}

export function TasksView() {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState("")
  const [msg, setMsg] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    try {
      const data = await getSyncedTasks()
      setTasks(data)
    } catch {
      // offline
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const val = text.trim()
    if (!val) return
    try {
      await addSyncedTask({ title: val })
      setText("")
      setMsg(t("tasks.created"))
      setTimeout(() => {
        setMsg("")
        inputRef.current?.focus()
      }, 1500)
      refresh()
    } catch {
      setMsg(t("tasks.createError"))
      setTimeout(() => setMsg(""), 3000)
    }
  }

  async function handleToggle(task: Task) {
    const idx = STATUS_ORDER.indexOf(task.status)
    const next = STATUS_ORDER[
      (idx + 1) % STATUS_ORDER.length
    ]
    try {
      await updateSyncedTask(task, { status: next })
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: next } : t
        ),
      )
    } catch {
      // ignore
    }
  }

  // Group by status, ordered
  const grouped = STATUS_ORDER
    .map((status) => ({
      status,
      items: tasks.filter((t) => t.status === status),
    }))
    .filter((g) => g.items.length > 0)

  return (
    <div className="tasks-view">
      <form
        className="inbox-capture"
        onSubmit={handleSubmit}
      >
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("tasks.addPlaceholder")}
          className="inbox-input"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="inbox-submit"
        >
          <svg width="18" height="18" viewBox="0 0 20 20"
            fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round">
            <line x1="10" y1="4" x2="10" y2="16" />
            <line x1="4" y1="10" x2="16" y2="10" />
          </svg>
        </button>
      </form>

      {msg && <p className="inbox-msg">{msg}</p>}

      {loading ? (
        <p className="inbox-empty">{t("common.loading")}</p>
      ) : tasks.length === 0 ? (
        <p className="inbox-empty">{t("tasks.empty")}</p>
      ) : (
        <div className="tasks-list">
          {grouped.map((group) => (
            <div key={group.status} className="task-group">
              <p className="task-group-label">
                {statusLabel(group.status)}
                <span className="task-group-count">
                  {group.items.length}
                </span>
              </p>
              {group.items.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
