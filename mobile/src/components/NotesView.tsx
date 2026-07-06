import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  getAppConfig,
  getCustomers,
  getTasks,
  getSyncedNotes,
  addSyncedNote,
  deleteSyncedNote,
  updateSyncedNote,
} from "../api"
import type { AppConfig } from "../api"
import type {
  Customer, Note, TaskRef,
} from "../types"
import {
  formatShortDate,
  formatFullDate,
} from "../utils/formatDate"
import { tagBadgeStyle } from "../utils/tagColors"
import { SearchBar } from "./SearchBar"
import { SwipeToReveal } from "./SwipeToReveal"
import { TagEditor } from "./TagEditor"
import { Modal } from "./Modal"
import { Field, Select } from "./Field"

function NoteRow({
  note,
  onDelete,
  onSelect,
  allTags,
  onTagClick,
}: {
  note: Note
  onDelete: (note: Note) => void
  onSelect: (note: Note) => void
  allTags: { name: string; color: string }[]
  onTagClick: (tag: string) => void
}) {
  const { t } = useTranslation()
  const created = note.created_at
    ? formatShortDate(note.created_at)
    : ""

  return (
    <SwipeToReveal
      className="note-row"
      onClick={() => onSelect(note)}
      revealAction={
        <button
          className="inbox-delete-btn"
          style={{ flex: 1 }}
          onClick={(e) => {
            e.stopPropagation()
            onDelete(note)
          }}
        >
          {t("inbox.delete")}
        </button>
      }
    >
      <div className="note-row-inner">
        <div className="note-row-header">
          {note.customer && (
            <span className="inbox-customer">
              {note.customer}
            </span>
          )}
          <span className="inbox-date">{created}</span>
        </div>
        <p className="task-title">{note.title}</p>
        {note.tags && note.tags.length > 0 && (
          <div className="note-row-tags">
            {note.tags.map((tag) => {
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
    </SwipeToReveal>
  )
}

function NoteDetailSheet({
  note,
  onClose,
  onUpdate,
  config,
  customers,
  tasks,
}: {
  note: Note
  onClose: () => void
  onUpdate: (updates: Partial<Note>) => void
  config: AppConfig
  customers: Customer[]
  tasks: TaskRef[]
}) {
  const { t } = useTranslation()
  const [customer, setCustomer] = useState(
    note.customer || "",
  )
  const [title, setTitle] = useState(note.title)
  const [taskId, setTaskId] = useState(
    note.task_id || "",
  )
  const [body, setBody] = useState(note.body || "")
  const [tags, setTags] = useState(note.tags || [])

  const created = note.created_at
    ? formatFullDate(note.created_at)
    : ""

  const filteredTasks = customer
    ? tasks.filter((task) => task.customer === customer)
    : tasks

  function handleSave() {
    onUpdate({
      customer,
      title,
      task_id: taskId || null,
      body,
      tags,
    })
    onClose()
  }

  return (
    <Modal
      title={t("detail.edit")}
      subtitle={created
        ? t("detail.created") + " · " + created
        : undefined}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
          >
            {t("edit.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
          >
            {t("detail.save")}
          </button>
        </>
      }
    >
      <Field label={t("detail.title")}>
        <input
          className="field-control"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
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

      {filteredTasks.length > 0 && (
        <Field label={t("detail.task")}>
          <Select value={taskId} onChange={setTaskId}>
            <option value="">—</option>
            {filteredTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
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

      <Field label={t("tasks.tagsLabel", "Tags")}>
        <TagEditor
          tags={tags}
          editing={true}
          onChange={setTags}
          allTags={config.tags}
        />
      </Field>
    </Modal>
  )
}

export function NotesView() {
  const { t } = useTranslation()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState("")
  const [msg, setMsg] = useState("")
  const [selected, setSelected] =
    useState<Note | null>(null)
  const [config, setConfig] =
    useState<AppConfig>({
      tags: [], github_configured: false,
    })
  const [customers, setCustomers] =
    useState<Customer[]>([])
  const [refTasks, setRefTasks] =
    useState<TaskRef[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState("")
  const [searchTags, setSearchTags] = useState<
    string[]
  >([])
  const inputRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    try {
      const data = await getSyncedNotes()
      setNotes(
        data.sort((a, b) =>
          (b.created_at || "").localeCompare(
            a.created_at || "",
          ),
        ),
      )
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
    getTasks()
      .then(setRefTasks)
      .catch(() => {})
  }, [])

  const filtered = notes.filter((n) => {
    if (searchTags.length > 0) {
      if (!searchTags.every(
        (t) => n.tags?.includes(t),
      )) return false
    }
    if (searchText) {
      const q = searchText.toLowerCase()
      const hay = [
        n.title, n.body, n.customer,
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const val = title.trim()
    if (!val) return
    try {
      await addSyncedNote({ title: val })
      setTitle("")
      setMsg(t("notes.created"))
      setTimeout(() => {
        setMsg("")
        inputRef.current?.focus()
      }, 1500)
      refresh()
    } catch {
      setMsg(t("notes.createError"))
      setTimeout(() => setMsg(""), 3000)
    }
  }

  async function handleUpdate(
    note: Note,
    updates: Partial<Note>,
  ) {
    try {
      await updateSyncedNote(note, updates)
      const updated = { ...note, ...updates }
      setNotes((prev) =>
        prev.map((n) =>
          n.id === note.id ? updated : n
        ),
      )
      setSelected(updated)
    } catch {
      // ignore
    }
  }

  async function handleDelete(note: Note) {
    try {
      await deleteSyncedNote(note)
      setNotes((prev) =>
        prev.filter((n) => n.id !== note.id),
      )
    } catch {
      // ignore
    }
  }

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
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("notes.addPlaceholder")}
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
            disabled={!title.trim()}
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
          {t("entries.loading")}
        </p>
      ) : filtered.length === 0 ? (
        <p className="inbox-empty">{t("notes.empty")}</p>
      ) : (
        <div className="inbox-list">
          {filtered.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              onDelete={handleDelete}
              onSelect={setSelected}
              allTags={config.tags}
              onTagClick={toggleSearchTag}
            />
          ))}
        </div>
      )}

      {selected && (
        <NoteDetailSheet
          note={selected}
          onClose={() => setSelected(null)}
          onUpdate={(updates) =>
            handleUpdate(selected, updates)
          }
          config={config}
          customers={customers}
          tasks={refTasks}
        />
      )}
    </div>
  )
}
