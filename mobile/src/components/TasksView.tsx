import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  addSyncedTask,
  getAppConfig,
  getSyncedTasks,
  updateSyncedTask,
} from "../api"
import type { AppConfig } from "../api"
import type { Task } from "../types"
import { formatFullDate } from "../utils/formatDate"
import { Markdown } from "./Markdown"
import { TagEditor } from "./TagEditor"

const STATUS_ORDER = [
  "TODO", "NEXT", "IN-PROGRESS", "WAIT",
  "DONE", "CANCELLED",
]

function statusLabel(status: string): string {
  return status.replace(/-/g, " ")
}

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    "TODO": "task-status-todo",
    "NEXT": "task-status-next",
    "IN-PROGRESS": "task-status-progress",
    "WAIT": "task-status-wait",
    "DONE": "task-status-done",
    "CANCELLED": "task-status-cancelled",
  }
  return (
    <span
      className={
        "task-status-badge " + (cls[status] || "")
      }
    >
      {statusLabel(status)}
    </span>
  )
}

function TaskRow({
  task,
  onSelect,
}: {
  task: Task
  onSelect: (task: Task) => void
}) {
  return (
    <div
      className="task-row"
      onClick={() => onSelect(task)}
      style={{ cursor: "pointer" }}
    >
      <div className="task-row-left">
        <StatusBadge status={task.status} />
      </div>
      <div className="task-row-content">
        <p className="task-title">{task.title}</p>
        {task.customer && (
          <span className="task-customer">
            {task.customer}
          </span>
        )}
      </div>
      <span className="row-chevron">&#8250;</span>
    </div>
  )
}

function TaskDetailSheet({
  task,
  onClose,
  onUpdate,
  config,
}: {
  task: Task
  onClose: () => void
  onUpdate: (updates: Partial<Task>) => void
  config: AppConfig
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [body, setBody] = useState(task.body || "")
  const [githubUrl, setGithubUrl] = useState(
    task.github_url || "",
  )
  const [tags, setTags] = useState(task.tags || [])

  const created = task.created_at
    ? formatFullDate(task.created_at)
    : ""

  function handleSave() {
    onUpdate({
      title,
      body,
      github_url: githubUrl,
      tags,
    })
    setEditing(false)
  }

  return (
    <div className="detail-panel">
      <div className="detail-panel-header">
        <button
          className="detail-panel-back"
          onClick={onClose}
        >
          &#8249; {t("shell.group.organize")}
        </button>
        <span className="detail-panel-title" />
        <div className="detail-panel-actions">
          {!editing ? (
            <button
              className="detail-panel-back"
              onClick={() => setEditing(true)}
            >
              {t("detail.edit")}
            </button>
          ) : (
            <button
              className="detail-panel-back"
              onClick={handleSave}
            >
              {t("detail.save")}
            </button>
          )}
        </div>
      </div>
      <div className="detail-panel-body">
        <h3 style={{ margin: "0 0 16px" }}>
          {task.title}
        </h3>
        <div className="detail-field">
          <div className="detail-label">
            {t("detail.status")}
          </div>
          <select
            className="detail-select"
            value={task.status}
            onChange={(e) =>
              onUpdate({ status: e.target.value })
            }
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </div>

          {editing ? (
            <>
              <div className="detail-field">
                <div className="detail-label">
                  {t("detail.title")}
                </div>
                <input
                  className="detail-input"
                  value={title}
                  onChange={(e) =>
                    setTitle(e.target.value)
                  }
                />
              </div>
              <div className="detail-field">
                <div className="detail-label">
                  {t("detail.description")}
                </div>
                <textarea
                  className="detail-textarea"
                  value={body}
                  onChange={(e) =>
                    setBody(e.target.value)
                  }
                  rows={8}
                />
              </div>
              {config.github_configured && (
                <div className="detail-field">
                  <div className="detail-label">
                    {t("detail.github")}
                  </div>
                  <input
                    className="detail-input"
                    value={githubUrl}
                    onChange={(e) =>
                      setGithubUrl(e.target.value)
                    }
                    placeholder="https://github.com/..."
                  />
                </div>
              )}
              <TagEditor
                tags={tags}
                editing={true}
                onChange={setTags}
                allTags={config.tags}
              />
              <button
                className="detail-save-btn"
                onClick={handleSave}
              >
                {t("detail.save")}
              </button>
            </>
          ) : (
            <>
              {task.customer && (
                <div className="detail-field">
                  <div className="detail-label">
                    {t("timer.customer")}
                  </div>
                  <div className="detail-value">
                    {task.customer}
                  </div>
                </div>
              )}

              {task.body && (
                <div className="detail-field">
                  <div className="detail-label">
                    {t("detail.description")}
                  </div>
                  <Markdown>{task.body}</Markdown>
                </div>
              )}

              {config.github_configured
                && task.github_url && (
                <div className="detail-field">
                  <div className="detail-label">
                    {t("detail.github")}
                  </div>
                  <a
                    className="detail-link"
                    href={task.github_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {task.github_url}
                  </a>
                </div>
              )}

              <TagEditor
                tags={tags}
                editing={false}
                onChange={() => {}}
                allTags={config.tags}
              />

              {created && (
                <div className="detail-field">
                  <div className="detail-label">
                    {t("detail.created")}
                  </div>
                  <div className="detail-value">
                    {created}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
  )
}

const DEFAULT_CONFIG: AppConfig = {
  tags: [],
  github_configured: false,
}

export function TasksView() {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState("")
  const [msg, setMsg] = useState("")
  const [selected, setSelected] =
    useState<Task | null>(null)
  const [config, setConfig] =
    useState<AppConfig>(DEFAULT_CONFIG)
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
    getAppConfig()
      .then(setConfig)
      .catch(() => {})
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

  async function handleUpdate(
    task: Task,
    updates: Partial<Task>,
  ) {
    try {
      await updateSyncedTask(task, updates)
      const updated = { ...task, ...updates }
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? updated : t
        ),
      )
      setSelected(updated)
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
                  onSelect={setSelected}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {selected && (
        <TaskDetailSheet
          task={selected}
          onClose={() => setSelected(null)}
          onUpdate={(updates) =>
            handleUpdate(selected, updates)
          }
          config={config}
        />
      )}
    </div>
  )
}
