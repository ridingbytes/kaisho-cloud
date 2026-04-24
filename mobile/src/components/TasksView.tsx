import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  addSyncedTask,
  getAppConfig,
  getCustomers,
  getSyncedTasks,
  updateSyncedTask,
} from "../api"
import type { AppConfig } from "../api"
import type { Customer, Task } from "../types"
import { formatFullDate } from "../utils/formatDate"
import { tagBadgeStyle } from "../utils/tagColors"
import { Markdown } from "./Markdown"
import { SearchBar } from "./SearchBar"
import { TagEditor } from "./TagEditor"

const STATUS_ORDER = [
  "TODO", "NEXT", "IN-PROGRESS", "WAIT",
  "DONE", "CANCELLED",
]

function statusLabel(status: string): string {
  return status.replace(/-/g, " ")
}

const STATUS_COLORS: Record<string, string> = {
  "TODO": "#3b82f6",
  "NEXT": "#f59e0b",
  "IN-PROGRESS": "#f97316",
  "WAIT": "#8b5cf6",
  "DONE": "#22c55e",
  "CANCELLED": "#9ca3af",
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className="task-status-dot"
      style={{
        background: STATUS_COLORS[status] || "#9ca3af",
      }}
      title={statusLabel(status)}
    />
  )
}

function TaskRow({
  task,
  onSelect,
  allTags,
  onTagClick,
}: {
  task: Task
  onSelect: (task: Task) => void
  allTags: { name: string; color: string }[]
  onTagClick: (tag: string) => void
}) {
  return (
    <div
      className="task-row"
      onClick={() => onSelect(task)}
      style={{ cursor: "pointer" }}
    >
      <div className="task-row-left">
        <StatusDot status={task.status} />
      </div>
      <div className="task-row-content">
        <p className="task-title">{task.title}</p>
        {task.customer && (
          <span className="task-customer">
            {task.customer}
          </span>
        )}
        {task.tags && task.tags.length > 0 && (
          <div className="note-row-tags">
            {task.tags.map((tag) => {
              const c = allTags.find(
                (t) => t.name === tag,
              )?.color
              return (
                <button
                  key={tag}
                  className="note-row-tag"
                  style={
                    c ? tagBadgeStyle(c) : undefined
                  }
                  onClick={(e) => {
                    e.stopPropagation()
                    onTagClick(tag)
                  }}
                >
                  {tag}
                </button>
              )
            })}
          </div>
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
  customers,
}: {
  task: Task
  onClose: () => void
  onUpdate: (updates: Partial<Task>) => void
  config: AppConfig
  customers: Customer[]
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [customer, setCustomer] = useState(
    task.customer || "",
  )
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
      customer,
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
                  {t("timer.customer")}
                </div>
                <select
                  className="detail-select"
                  value={customer}
                  onChange={(e) =>
                    setCustomer(e.target.value)
                  }
                >
                  <option value="">—</option>
                  {customers.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
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
              <div className="detail-field detail-field-grow">
                <div className="detail-label">
                  {t("detail.description")}
                </div>
                <textarea
                  className="detail-textarea"
                  value={body}
                  onChange={(e) =>
                    setBody(e.target.value)
                  }
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
  const [customers, setCustomers] =
    useState<Customer[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState("")
  const [searchTags, setSearchTags] = useState<
    string[]
  >([])
  const [collapsed, setCollapsed] = useState(
    () => new Set(["DONE", "CANCELLED"]),
  )
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
    getCustomers()
      .then(setCustomers)
      .catch(() => {})
  }, [])

  const filtered = tasks.filter((task) => {
    if (searchTags.length > 0) {
      if (!searchTags.every(
        (t) => task.tags?.includes(t),
      )) return false
    }
    if (searchText) {
      const q = searchText.toLowerCase()
      const hay = [
        task.title, task.body, task.customer,
      ].join(" ").toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  function toggleSearchTag(tag: string) {
    setSearchTags((prev) =>
      prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : [...prev, tag],
    )
    if (!searchOpen) setSearchOpen(true)
  }

  function toggleCollapse(status: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

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
      items: filtered.filter(
        (t) => t.status === status,
      ),
    }))
    .filter((g) => g.items.length > 0)

  return (
    <div className="tasks-view">
      <form
        className="inbox-capture"
        onSubmit={handleSubmit}
      >
        {!searchOpen && (
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("tasks.addPlaceholder")}
            className="inbox-input"
          />
        )}
        <SearchBar
          searchText={searchText}
          onSearchChange={setSearchText}
          activeTags={searchTags}
          onTagToggle={toggleSearchTag}
          visible={searchOpen}
          onToggle={() => setSearchOpen(!searchOpen)}
          allTags={config.tags}
        />
        {!searchOpen && (
          <button
            type="submit"
            disabled={!text.trim()}
            className="inbox-submit"
          >
            <svg width="18" height="18"
              viewBox="0 0 20 20"
              fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round">
              <line x1="10" y1="4" x2="10" y2="16" />
              <line x1="4" y1="10" x2="16" y2="10" />
            </svg>
          </button>
        )}
      </form>

      {msg && <p className="inbox-msg">{msg}</p>}

      {loading ? (
        <p className="inbox-empty">
          {t("common.loading")}
        </p>
      ) : filtered.length === 0 ? (
        <p className="inbox-empty">
          {t("tasks.empty")}
        </p>
      ) : (
        <div className="tasks-list">
          {grouped.map((group) => (
            <div
              key={group.status}
              className="task-group"
            >
              <button
                className="task-group-label"
                onClick={() =>
                  toggleCollapse(group.status)
                }
              >
                <span className="task-group-chevron">
                  {collapsed.has(group.status)
                    ? "▸" : "▾"}
                </span>
                {statusLabel(group.status)}
                <span className="task-group-count">
                  {group.items.length}
                </span>
              </button>
              {!collapsed.has(group.status) &&
                group.items.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onSelect={setSelected}
                    allTags={config.tags}
                    onTagClick={toggleSearchTag}
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
          customers={customers}
        />
      )}
    </div>
  )
}
