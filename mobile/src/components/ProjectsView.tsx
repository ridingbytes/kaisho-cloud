import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  deleteSyncedNote,
  deleteSyncedProject,
  deleteSyncedTask,
  getAppConfig,
  getCustomers,
  getEntries,
  getSyncedNotes,
  getSyncedProjects,
  getSyncedTasks,
  newMilestoneId,
  newProjectId,
  updateSyncedNote,
  updateSyncedProject,
  updateSyncedTask,
} from "../api"
import type { AppConfig } from "../api"
import type {
  ClockEntry, Customer, Milestone, Note, Project, Task,
} from "../types"
import { PROJECT_STATES } from "../types"
import {
  milestoneProgress,
  projectColor,
  projectSortKey,
  PROJECT_PALETTE,
  statusColor,
  statusLabel,
} from "../utils/projects"
import { formatMins } from "../utils/time"
import { formatShortDate } from "../utils/formatDate"
import { DetailScreen } from "./DetailScreen"
import { Field, FieldRow, Select } from "./Field"
import { TagEditor } from "./TagEditor"
import { Markdown } from "./Markdown"
import { useConfirm } from "./ConfirmDialog"
import {
  TaskDetailSheet, stateColor, stateLabel,
} from "./TasksView"
import { NoteDetailSheet } from "./NotesView"
import { hexToRgba } from "../utils/tagColors"
import { EditEntrySheet } from "./EditEntrySheet"

const DEFAULT_CONFIG: AppConfig = {
  tags: [],
  github_configured: false,
}

/** Per-project rollups computed from tasks + entries. */
interface Stats {
  taskCount: number
  noteCount: number
  minutes: number
}

function computeStats(
  projects: Project[],
  tasks: Task[],
  notes: Note[],
  entries: ClockEntry[],
): Map<string, Stats> {
  const taskProject = new Map<string, string>()
  for (const task of tasks) {
    if (task.project) taskProject.set(task.id, task.project)
  }
  const map = new Map<string, Stats>()
  for (const p of projects) {
    map.set(p.id, { taskCount: 0, noteCount: 0, minutes: 0 })
  }
  for (const task of tasks) {
    if (task.project && map.has(task.project)) {
      map.get(task.project)!.taskCount++
    }
  }
  for (const note of notes) {
    if (note.project && map.has(note.project)) {
      map.get(note.project)!.noteCount++
    }
  }
  for (const entry of entries) {
    const pid =
      entry.project ||
      (entry.task_id ? taskProject.get(entry.task_id) : "")
    if (pid && map.has(pid) && entry.duration_minutes) {
      map.get(pid)!.minutes += entry.duration_minutes
    }
  }
  return map
}

// ── Milestones editor ─────────────────────────────────────

function MilestonesEditor({
  milestones,
  onChange,
}: {
  milestones: Milestone[]
  onChange: (next: Milestone[]) => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState("")

  function add() {
    const val = title.trim()
    if (!val) return
    onChange([
      ...milestones,
      { id: newMilestoneId(), title: val, done: false },
    ])
    setTitle("")
  }

  function toggle(id: string) {
    onChange(
      milestones.map((m) =>
        m.id === id ? { ...m, done: !m.done } : m,
      ),
    )
  }

  function remove(id: string) {
    onChange(milestones.filter((m) => m.id !== id))
  }

  return (
    <div className="milestones">
      {milestones.map((m) => (
        <div key={m.id} className="milestone-row">
          <button
            type="button"
            className={
              "milestone-check" +
              (m.done ? " milestone-check--done" : "")
            }
            onClick={() => toggle(m.id)}
            aria-label={m.title}
          >
            {m.done && (
              <svg
                width="12" height="12" viewBox="0 0 20 20"
                fill="none" stroke="currentColor"
                strokeWidth="3" strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="4 10 8.5 14.5 16 6" />
              </svg>
            )}
          </button>
          <span
            className={
              "milestone-title" +
              (m.done ? " milestone-title--done" : "")
            }
          >
            {m.title}
          </span>
          <button
            type="button"
            className="milestone-remove"
            onClick={() => remove(m.id)}
            aria-label="Remove"
          >
            &times;
          </button>
        </div>
      ))}
      <div className="milestone-add">
        <input
          className="field-control"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              add()
            }
          }}
          placeholder={t("projects.milestonePlaceholder")}
        />
        <button
          type="button"
          className="btn-secondary milestone-add-btn"
          onClick={add}
          disabled={!title.trim()}
        >
          {t("projects.addMilestone")}
        </button>
      </div>
    </div>
  )
}

// ── Project editor modal ──────────────────────────────────

function ProjectEditor({
  project,
  customers,
  allTags,
  tasks,
  notes,
  entries,
  config,
  onClose,
  onSaved,
  onDeleted,
}: {
  project: Project | null
  customers: Customer[]
  allTags: { name: string; color: string }[]
  tasks: Task[]
  notes: Note[]
  entries: ClockEntry[]
  config: AppConfig
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const isNew = !project
  const [drill, setDrill] = useState<
    { type: "task" | "note" | "entry"; item: any } | null
  >(null)

  const pid = project?.id || ""
  const linkedTasks = useMemo(
    () => tasks.filter((t) => t.project === pid),
    [tasks, pid],
  )
  const linkedNotes = useMemo(
    () => notes.filter((n) => n.project === pid),
    [notes, pid],
  )
  const linkedEntries = useMemo(() => {
    const taskPid = new Map<string, string | null | undefined>()
    for (const task of tasks) taskPid.set(task.id, task.project)
    return entries
      .filter(
        (e) =>
          e.project === pid ||
          (e.task_id && taskPid.get(e.task_id) === pid),
      )
      .sort((a, b) => b.start.localeCompare(a.start))
  }, [entries, tasks, pid])
  const linkedMinutes = useMemo(
    () =>
      linkedEntries.reduce(
        (sum, e) => sum + (e.duration_minutes || 0),
        0,
      ),
    [linkedEntries],
  )
  const [editing, setEditing] = useState(isNew)
  const [name, setName] = useState(project?.name || "")
  const [status, setStatus] = useState(
    project?.status || "ACTIVE",
  )
  const [customer, setCustomer] = useState(
    project?.customer || "",
  )
  const [contract, setContract] = useState(
    project?.contract || "",
  )
  const [color, setColor] = useState(
    project?.color || "",
  )
  const [start, setStart] = useState(project?.start || "")
  const [due, setDue] = useState(project?.due || "")
  const [description, setDescription] = useState(
    project?.description || "",
  )
  const [tags, setTags] = useState<string[]>(
    project?.tags || [],
  )
  const [milestones, setMilestones] = useState<Milestone[]>(
    project?.milestones || [],
  )
  const [saving, setSaving] = useState(false)
  const [confirm, confirmDialog] = useConfirm()

  const selCustomer = customers.find(
    (c) => c.name === customer,
  )
  const contracts = selCustomer?.contracts ?? []
  const effColor = color || (project
    ? projectColor(project)
    : PROJECT_PALETTE[0])

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    // /sync/projects/apply is an upsert keyed on id, so
    // create and edit are the same single round-trip: build
    // the full entry and let the base project fill the rest.
    const base: Project = project || {
      id: newProjectId(),
      name: "",
      customer: "",
      status: "ACTIVE",
      color: "",
      tags: [],
      description: "",
      milestones: [],
      updated_at: new Date().toISOString(),
    }
    try {
      await updateSyncedProject(base, {
        name: name.trim(),
        status,
        customer,
        contract: contract || null,
        color,
        start: start || null,
        due: due || null,
        description,
        tags,
        milestones,
      })
      setSaving(false)
      onSaved()
      if (isNew) onClose()
      else setEditing(false)
    } catch {
      setSaving(false)
    }
  }

  function cancelEdit() {
    if (isNew) {
      onClose()
      return
    }
    setName(project.name)
    setStatus(project.status)
    setCustomer(project.customer || "")
    setContract(project.contract || "")
    setColor(project.color || "")
    setStart(project.start || "")
    setDue(project.due || "")
    setDescription(project.description || "")
    setTags(project.tags || [])
    setMilestones(project.milestones || [])
    setEditing(false)
  }

  async function handleDelete() {
    if (!project) return
    const ok = await confirm(t("projects.confirmDelete"))
    if (!ok) return
    try {
      await deleteSyncedProject(project)
      onDeleted()
    } catch {
      // stay open on failure
    }
  }

  const msDone = milestones.filter((m) => m.done).length
  const navAction = editing ? (
    <button
      className="ds-nav-btn"
      onClick={handleSave}
      disabled={saving || !name.trim()}
    >
      {saving ? t("edit.saving") : t("edit.save")}
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
    <>
      <DetailScreen
        title={isNew ? t("projects.new") : name}
        backLabel={t("shell.tab.projects")}
        onBack={onClose}
        accent={effColor}
        action={navAction}
        leftAction={editing ? (
          <button className="ds-nav-btn" onClick={cancelEdit}>
            {t("edit.cancel")}
          </button>
        ) : undefined}
      >
        {editing ? (
          <div className="ds-form">
            <Field label={t("projects.name")}>
              <input
                className="field-control"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("projects.namePlaceholder")}
              />
            </Field>

            <FieldRow>
              <Field label={t("detail.status")}>
                <Select value={status} onChange={setStatus}>
                  {PROJECT_STATES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("timer.customer")}>
                <Select
                  value={customer}
                  onChange={setCustomer}
                >
                  <option value="">—</option>
                  {customers.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldRow>

            {contracts.length > 0 && (
              <Field label={t("edit.label.contract")}>
                <Select
                  value={contract}
                  onChange={setContract}
                >
                  <option value="">
                    {t("edit.contract.none")}
                  </option>
                  {contracts.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field label={t("projects.color")}>
              <div className="color-swatches">
                {PROJECT_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={
                      "color-swatch" +
                      (effColor === c
                        ? " color-swatch--active"
                        : "")
                    }
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    aria-label={c}
                  />
                ))}
              </div>
            </Field>

            <FieldRow>
              <Field label={t("projects.start")}>
                <input
                  className="field-control"
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </Field>
              <Field label={t("projects.due")}>
                <input
                  className="field-control"
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </Field>
            </FieldRow>

            <Field label={t("detail.description")}>
              <textarea
                className="field-control"
                value={description}
                onChange={(e) =>
                  setDescription(e.target.value)
                }
                rows={4}
              />
            </Field>

            <Field label={t("projects.milestones")}>
              <MilestonesEditor
                milestones={milestones}
                onChange={setMilestones}
              />
            </Field>

            <TagEditor
              tags={tags}
              editing={true}
              onChange={setTags}
              allTags={allTags}
            />

            {!isNew && (
              <button
                type="button"
                className="btn-danger ds-delete"
                onClick={handleDelete}
              >
                {t("detail.delete")}
              </button>
            )}
          </div>
        ) : (
          <div className="ds-content">
            <div className="view-hero">
              <div className="view-hero-title">{name}</div>
              <div className="view-pills">
                <span
                  className="project-status-pill"
                  style={{
                    color: statusColor(status),
                    background: statusColor(status) + "1f",
                  }}
                >
                  {statusLabel(status)}
                </span>
                {customer && (
                  <span className="inbox-customer">
                    {customer}
                  </span>
                )}
              </div>
            </div>

            {milestones.length > 0 && (
              <div>
                <div className="view-block-label">
                  {t("projects.milestones")}
                  {"  "}
                  {msDone}/{milestones.length}
                </div>
                <div className="view-section">
                  {milestones.map((m) => (
                    <div key={m.id} className="view-milestone">
                      <span
                        className={
                          "milestone-dot" +
                          (m.done
                            ? " milestone-dot--done"
                            : "")
                        }
                        style={
                          m.done
                            ? { background: effColor }
                            : undefined
                        }
                      />
                      <span
                        className={
                          m.done
                            ? "milestone-title--done"
                            : ""
                        }
                      >
                        {m.title}
                      </span>
                      {m.due && (
                        <span className="view-milestone-due">
                          {m.due}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(contract || start || due) && (
              <div className="view-section">
                {contract && (
                  <div className="view-row">
                    <span className="view-row-label">
                      {t("edit.label.contract")}
                    </span>
                    <span className="view-row-value">
                      {contract}
                    </span>
                  </div>
                )}
                {start && (
                  <div className="view-row">
                    <span className="view-row-label">
                      {t("projects.start")}
                    </span>
                    <span className="view-row-value">
                      {start}
                    </span>
                  </div>
                )}
                {due && (
                  <div className="view-row">
                    <span className="view-row-label">
                      {t("projects.due")}
                    </span>
                    <span className="view-row-value">
                      {due}
                    </span>
                  </div>
                )}
              </div>
            )}

            {description && (
              <div>
                <div className="view-block-label">
                  {t("detail.description")}
                </div>
                <div className="view-body">
                  <Markdown>{description}</Markdown>
                </div>
              </div>
            )}

            {linkedTasks.length > 0 && (
              <div className="project-links-section">
                <div className="view-block-label">
                  {t("shell.tab.tasks")} · {linkedTasks.length}
                </div>
                <div className="project-links">
                  {linkedTasks.map((task) => (
                    <button
                      key={task.id}
                      className="project-link-row"
                      onClick={() =>
                        setDrill({ type: "task", item: task })
                      }
                    >
                      <span className="project-link-title">
                        {task.title}
                      </span>
                      <span
                        className="project-link-status"
                        style={{
                          color: stateColor(
                            task.status, config.task_states,
                          ),
                          background: hexToRgba(
                            stateColor(
                              task.status,
                              config.task_states,
                            ),
                            0.15,
                          ),
                        }}
                      >
                        {stateLabel(
                          task.status, config.task_states,
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {linkedNotes.length > 0 && (
              <div className="project-links-section">
                <div className="view-block-label">
                  {t("shell.tab.notes")} · {linkedNotes.length}
                </div>
                <div className="project-links">
                  {linkedNotes.map((note) => (
                    <button
                      key={note.id}
                      className="project-link-row"
                      onClick={() =>
                        setDrill({ type: "note", item: note })
                      }
                    >
                      <span className="project-link-title">
                        {note.title}
                      </span>
                      <span className="project-link-meta">
                        {note.created_at
                          ? formatShortDate(note.created_at)
                          : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {linkedEntries.length > 0 && (
              <div className="project-links-section">
                <div className="view-block-label">
                  {t("shell.group.time")} ·{" "}
                  {formatMins(linkedMinutes)}
                </div>
                <div className="project-links">
                  {linkedEntries.map((entry) => (
                    <button
                      key={entry.id}
                      className="project-link-row"
                      onClick={() =>
                        setDrill({ type: "entry", item: entry })
                      }
                    >
                      <span className="project-link-title">
                        {formatShortDate(entry.start)}
                        {entry.description
                          ? ` · ${entry.description}`
                          : ""}
                      </span>
                      <span className="project-link-meta">
                        {formatMins(entry.duration_minutes)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tags.length > 0 && (
              <TagEditor
                tags={tags}
                editing={false}
                onChange={() => {}}
                allTags={allTags}
              />
            )}
          </div>
        )}
      </DetailScreen>
      {confirmDialog}
      {drill?.type === "task" && (
        <TaskDetailSheet
          task={drill.item}
          config={config}
          customers={customers}
          onClose={() => setDrill(null)}
          onUpdate={(u) => {
            updateSyncedTask(drill.item, u)
            onSaved()
          }}
          onDelete={() => {
            deleteSyncedTask(drill.item)
            setDrill(null)
            onSaved()
          }}
        />
      )}
      {drill?.type === "note" && (
        <NoteDetailSheet
          note={drill.item}
          config={config}
          customers={customers}
          tasks={tasks}
          onClose={() => setDrill(null)}
          onUpdate={(u) => {
            updateSyncedNote(drill.item, u)
            onSaved()
          }}
          onDelete={() => {
            deleteSyncedNote(drill.item)
            setDrill(null)
            onSaved()
          }}
        />
      )}
      {drill?.type === "entry" && (
        <EditEntrySheet
          entry={drill.item}
          onClose={() => setDrill(null)}
          onSaved={() => {
            setDrill(null)
            onSaved()
          }}
        />
      )}
    </>
  )
}

// ── Project card ──────────────────────────────────────────

function ProjectCard({
  project,
  stats,
  onSelect,
}: {
  project: Project
  stats?: Stats
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const color = projectColor(project)
  const progress = milestoneProgress(project)
  const msTotal = project.milestones?.length || 0
  const msDone =
    project.milestones?.filter((m) => m.done).length || 0

  return (
    <button
      className="project-card"
      style={{ borderLeftColor: color }}
      onClick={onSelect}
    >
      <div className="project-card-head">
        <span className="project-card-name">
          {project.name}
        </span>
        <span
          className="project-status-pill"
          style={{
            color: statusColor(project.status),
            background:
              statusColor(project.status) + "1f",
          }}
        >
          {statusLabel(project.status)}
        </span>
      </div>

      {project.customer && (
        <div className="project-card-customer">
          {project.customer}
        </div>
      )}

      {msTotal > 0 && (
        <div className="project-progress">
          <div className="project-progress-track">
            <div
              className="project-progress-fill"
              style={{
                width: `${progress * 100}%`,
                background: color,
              }}
            />
          </div>
          <span className="project-progress-label">
            {msDone}/{msTotal}
          </span>
        </div>
      )}

      <div className="project-card-meta">
        {stats && stats.taskCount > 0 && (
          <span>
            {t("projects.taskCount", {
              count: stats.taskCount,
            })}
          </span>
        )}
        {stats && stats.minutes > 0 && (
          <span>{formatMins(stats.minutes)}</span>
        )}
        {project.due && (
          <span className="project-due">
            {t("projects.dueShort")} {project.due}
          </span>
        )}
      </div>
    </button>
  )
}

// ── Container ─────────────────────────────────────────────

export function ProjectsView() {
  const { t } = useTranslation()
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [entries, setEntries] = useState<ClockEntry[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [config, setConfig] =
    useState<AppConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<
    Project | null | "new"
  >(null)
  const [showArchived, setShowArchived] = useState(false)

  async function refresh() {
    try {
      const [ps, ts, ns, es] = await Promise.all([
        getSyncedProjects(),
        getSyncedTasks(),
        getSyncedNotes(),
        getEntries({ period: "year" }),
      ])
      setProjects(ps)
      setTasks(ts)
      setNotes(ns)
      setEntries(es)
    } catch {
      // offline
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    getCustomers().then(setCustomers).catch(() => {})
    getAppConfig()
      .then(setConfig)
      .catch(() => {})
  }, [])

  const allTags = config.tags

  const stats = useMemo(
    () => computeStats(projects, tasks, notes, entries),
    [projects, tasks, notes, entries],
  )

  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) =>
        projectSortKey(a).localeCompare(projectSortKey(b)),
      ),
    [projects],
  )

  const visible = sorted.filter(
    (p) => showArchived || p.status !== "ARCHIVED",
  )
  const archivedCount = projects.filter(
    (p) => p.status === "ARCHIVED",
  ).length

  return (
    <div className="projects-view">
      <div className="projects-header">
        <h2 className="projects-title">
          {t("shell.tab.projects")}
        </h2>
        <button
          className="btn-primary projects-new-btn"
          onClick={() => setEditing("new")}
        >
          + {t("projects.new")}
        </button>
      </div>

      {loading ? (
        <p className="inbox-empty">{t("entries.loading")}</p>
      ) : visible.length === 0 ? (
        <div className="projects-empty">
          <p>{t("projects.empty")}</p>
          <button
            className="btn-secondary"
            onClick={() => setEditing("new")}
          >
            + {t("projects.new")}
          </button>
        </div>
      ) : (
        <div className="projects-list">
          {visible.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              stats={stats.get(p.id)}
              onSelect={() => setEditing(p)}
            />
          ))}
        </div>
      )}

      {archivedCount > 0 && (
        <button
          className="projects-archived-toggle"
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived
            ? t("projects.hideArchived")
            : t("projects.showArchived", {
                count: archivedCount,
              })}
        </button>
      )}

      {editing !== null && (
        <ProjectEditor
          project={editing === "new" ? null : editing}
          customers={customers}
          allTags={allTags}
          tasks={tasks}
          notes={notes}
          entries={entries}
          config={config}
          onClose={() => setEditing(null)}
          onSaved={refresh}
          onDeleted={() => {
            setEditing(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}
