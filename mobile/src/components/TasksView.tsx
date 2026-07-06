import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  addSyncedTask,
  getAppConfig,
  getCustomers,
  getSyncedProjects,
  getSyncedTasks,
  updateSyncedTask,
} from "../api"
import type { AppConfig } from "../api"
import type { Customer, Project, Task } from "../types"
import { formatFullDate } from "../utils/formatDate"
import {
  hexToRgba, tagBadgeStyle,
} from "../utils/tagColors"
import { SearchBar } from "./SearchBar"
import { TagEditor } from "./TagEditor"
import { Markdown } from "./Markdown"
import { DetailScreen } from "./DetailScreen"
import { Field, Select } from "./Field"
import { ProjectPicker, ProjectBadge } from "./ProjectPicker"

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

function TaskRow({
  task,
  onSelect,
  allTags,
  projects,
  onTagClick,
  onStatusClick,
}: {
  task: Task
  onSelect: (task: Task) => void
  allTags: { name: string; color: string }[]
  projects: Project[]
  onTagClick: (tag: string) => void
  onStatusClick: (status: string) => void
}) {
  const sc = STATUS_COLORS[task.status] || "#9ca3af"
  return (
    <div
      className="task-row"
      onClick={() => onSelect(task)}
      style={{ cursor: "pointer" }}
    >
      <div className="task-row-content">
        <p className="task-title">{task.title}</p>
        {task.customer && (
          <span className="task-customer">
            {task.customer}
          </span>
        )}
        <div className="note-row-tags">
          <button
            className="note-row-tag"
            style={{
              background: hexToRgba(sc, 0.15),
              color: sc,
              borderColor: hexToRgba(sc, 0.35),
            }}
            onClick={(e) => {
              e.stopPropagation()
              onStatusClick(task.status)
            }}
          >
            {statusLabel(task.status)}
          </button>
          <ProjectBadge
            projectId={task.project}
            projects={projects}
          />
          {task.tags?.map((tag) => {
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
  const [status, setStatus] = useState(task.status)
  const [body, setBody] = useState(task.body || "")
  const [githubUrl, setGithubUrl] = useState(
    task.github_url || "",
  )
  const [tags, setTags] = useState(task.tags || [])
  const [projectId, setProjectId] = useState(
    task.project || "",
  )
  const [milestoneId, setMilestoneId] = useState(
    task.milestone || "",
  )
  const [projects, setProjects] = useState<Project[]>([])

  useEffect(() => {
    getSyncedProjects().then(setProjects).catch(() => {})
  }, [])

  const created = task.created_at
    ? formatFullDate(task.created_at)
    : ""
  const sc = STATUS_COLORS[task.status] || "#9ca3af"
  const selProject = projects.find(
    (p) => p.id === projectId,
  )
  const milestones = selProject?.milestones || []
  const activeMilestone = milestones.find(
    (m) => m.id === task.milestone,
  )

  function cancelEdit() {
    setCustomer(task.customer || "")
    setTitle(task.title)
    setStatus(task.status)
    setBody(task.body || "")
    setGithubUrl(task.github_url || "")
    setTags(task.tags || [])
    setProjectId(task.project || "")
    setMilestoneId(task.milestone || "")
    setEditing(false)
  }

  function handleSave() {
    onUpdate({
      customer,
      title,
      status,
      body,
      github_url: githubUrl,
      tags,
      project: projectId || null,
      milestone: projectId ? milestoneId || null : null,
    })
    setEditing(false)
  }

  const navAction = editing ? (
    <button className="ds-nav-btn" onClick={handleSave}>
      {t("detail.save")}
    </button>
  ) : (
    <button
      className="ds-nav-btn"
      onClick={() => setEditing(true)}
    >
      {t("detail.edit")}
    </button>
  )

  return (
    <DetailScreen
      title={task.title}
      backLabel={t("shell.tab.tasks")}
      onBack={onClose}
      action={navAction}
      leftAction={editing ? (
        <button className="ds-nav-btn" onClick={cancelEdit}>
          {t("edit.cancel")}
        </button>
      ) : undefined}
    >
      {editing ? (
        <div className="ds-form">
          <Field label={t("detail.title")}>
            <input
              className="field-control"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>

          <Field label={t("detail.status")}>
            <Select value={status} onChange={setStatus}>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("timer.customer")}>
            <Select value={customer} onChange={setCustomer}>
              <option value="">—</option>
              {customers.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("projects.label")}>
            <ProjectPicker
              value={projectId}
              projects={projects}
              onChange={(id) => {
                setProjectId(id)
                setMilestoneId("")
              }}
            />
          </Field>

          {milestones.length > 0 && (
            <Field label={t("projects.milestones")}>
              <Select
                value={milestoneId}
                onChange={setMilestoneId}
              >
                <option value="">—</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label={t("detail.description")} grow>
            <textarea
              className="field-control"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
            />
          </Field>

          {config.github_configured && (
            <Field label={t("detail.github")}>
              <input
                className="field-control"
                value={githubUrl}
                onChange={(e) =>
                  setGithubUrl(e.target.value)
                }
                placeholder="https://github.com/..."
              />
            </Field>
          )}

          <TagEditor
            tags={tags}
            editing={true}
            onChange={setTags}
            allTags={config.tags}
          />
        </div>
      ) : (
        <div className="ds-content">
          <div className="view-hero">
            <div className="view-hero-title">
              {task.title}
            </div>
            <div className="view-pills">
              <span
                className="project-status-pill"
                style={{
                  color: sc,
                  background: hexToRgba(sc, 0.15),
                }}
              >
                {statusLabel(task.status)}
              </span>
              <ProjectBadge
                projectId={task.project}
                projects={projects}
              />
              {activeMilestone && (
                <span className="view-milestone-chip">
                  ◆ {activeMilestone.title}
                </span>
              )}
            </div>
          </div>

          <div className="view-section">
            {task.customer && (
              <div className="view-row">
                <span className="view-row-label">
                  {t("timer.customer")}
                </span>
                <span className="view-row-value">
                  {task.customer}
                </span>
              </div>
            )}
            {created && (
              <div className="view-row">
                <span className="view-row-label">
                  {t("detail.created")}
                </span>
                <span className="view-row-value">
                  {created}
                </span>
              </div>
            )}
            {config.github_configured
              && task.github_url && (
              <div className="view-row">
                <span className="view-row-label">
                  {t("detail.github")}
                </span>
                <a
                  className="view-row-value detail-link"
                  href={task.github_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("detail.openLink")}
                </a>
              </div>
            )}
          </div>

          {task.body && (
            <div>
              <div className="view-block-label">
                {t("detail.description")}
              </div>
              <div className="view-body">
                <Markdown>{task.body}</Markdown>
              </div>
            </div>
          )}

          {task.tags && task.tags.length > 0 && (
            <TagEditor
              tags={task.tags}
              editing={false}
              onChange={() => {}}
              allTags={config.tags}
            />
          )}
        </div>
      )}
    </DetailScreen>
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
  const [projects, setProjects] =
    useState<Project[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState("")
  const [searchTags, setSearchTags] = useState<
    string[]
  >([])
  const [searchStatus, setSearchStatus] = useState("")
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
    getSyncedProjects()
      .then(setProjects)
      .catch(() => {})
  }, [])

  const filtered = tasks.filter((task) => {
    if (searchStatus && task.status !== searchStatus) {
      return false
    }
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

  function toggleStatusFilter(status: string) {
    setSearchStatus((prev) =>
      prev === status ? "" : status,
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

  function toggleAll(groups: string[]) {
    const allCollapsed = groups.every(
      (g) => collapsed.has(g),
    )
    setCollapsed(
      allCollapsed ? new Set() : new Set(groups),
    )
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
          statusChip={searchStatus ? {
            label: statusLabel(searchStatus),
            color: STATUS_COLORS[searchStatus]
              || "#9ca3af",
            onRemove: () => setSearchStatus(""),
          } : undefined}
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
          <div className="tasks-list-toolbar">
            <button
              className="tasks-toggle-all"
              onClick={() =>
                toggleAll(grouped.map((g) => g.status))
              }
            >
              {grouped.every(
                (g) => collapsed.has(g.status),
              )
                ? t("tasks.expandAll")
                : t("tasks.collapseAll")}
            </button>
          </div>
          {grouped.map((group) => {
            const isCollapsed =
              collapsed.has(group.status)
            const color =
              STATUS_COLORS[group.status] || "#9ca3af"
            return (
              <div
                key={group.status}
                className="task-group"
              >
                <button
                  className="task-group-label"
                  onClick={() =>
                    toggleCollapse(group.status)
                  }
                  style={{
                    borderLeftColor: color,
                    background: hexToRgba(color, 0.06),
                  }}
                >
                  <span className="task-group-chevron">
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                  <span
                    className="task-group-status"
                    style={{ color }}
                  >
                    {statusLabel(group.status)}
                  </span>
                  <span className="task-group-count">
                    {group.items.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="task-group-rows">
                    {group.items.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onSelect={setSelected}
                        allTags={config.tags}
                        projects={projects}
                        onTagClick={toggleSearchTag}
                        onStatusClick={toggleStatusFilter}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
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
