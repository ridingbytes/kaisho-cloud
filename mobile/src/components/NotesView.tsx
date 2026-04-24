import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
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
import { Markdown } from "./Markdown"
import { SearchBar } from "./SearchBar"
import { TagEditor } from "./TagEditor"

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
  const [swiped, setSwiped] = useState(false)
  const startX = useRef(0)

  function handleTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX
    setSwiped(false)
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const dx = e.changedTouches[0].clientX - startX.current
    if (dx < -80) setSwiped(true)
    else setSwiped(false)
  }

  const created = note.created_at
    ? formatShortDate(note.created_at)
    : ""

  return (
    <div
      className={
        "note-row" + (swiped ? " swiped" : "")
      }
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={() => !swiped && onSelect(note)}
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
      {!swiped && (
        <span className="row-chevron">&#8250;</span>
      )}
      {swiped && (
        <button
          className="inbox-delete-btn"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(note)
          }}
        >
          {t("inbox.delete")}
        </button>
      )}
    </div>
  )
}

function NoteDetailSheet({
  note,
  onClose,
  onDelete,
  onUpdate,
  config,
  customers,
  tasks,
}: {
  note: Note
  onClose: () => void
  onDelete: (note: Note) => void
  onUpdate: (updates: Partial<Note>) => void
  config: AppConfig
  customers: Customer[]
  tasks: TaskRef[]
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
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
    ? tasks.filter((t) => t.customer === customer)
    : tasks

  function handleSave() {
    onUpdate({
      customer,
      title,
      task_id: taskId || null,
      body,
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
          {note.title}
        </h3>
        {editing ? (
          <div className="detail-edit-form">
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
              {filteredTasks.length > 0 && (
                <div className="detail-field">
                  <div className="detail-label">
                    {t("detail.task")}
                  </div>
                  <select
                    className="detail-select"
                    value={taskId}
                    onChange={(e) =>
                      setTaskId(e.target.value)
                    }
                  >
                    <option value="">—</option>
                    {filteredTasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
              <TagEditor
                tags={tags}
                editing={true}
                onChange={setTags}
                allTags={config.tags}
              />
            </div>
          ) : (
            <>
              <div className="detail-field">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  {note.customer && (
                    <span className="inbox-customer">
                      {note.customer}
                    </span>
                  )}
                  {created && (
                    <span className="inbox-date">
                      {created}
                    </span>
                  )}
                </div>
              </div>

              {note.body && (
                <div className="detail-field">
                  <div className="detail-label">
                    {t("detail.description")}
                  </div>
                  <Markdown>{note.body}</Markdown>
                </div>
              )}

              <TagEditor
                tags={tags}
                editing={false}
                onChange={() => {}}
                allTags={config.tags}
              />

              <button
                className="detail-delete-btn"
                onClick={() => {
                  onDelete(note)
                  onClose()
                }}
              >
                {t("detail.delete")}
              </button>
            </>
          )}
        </div>
      </div>
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

      {selected && createPortal(
        <NoteDetailSheet
          note={selected}
          onClose={() => setSelected(null)}
          onDelete={handleDelete}
          onUpdate={(updates) =>
            handleUpdate(selected, updates)
          }
          config={config}
          customers={customers}
          tasks={refTasks}
        />,
        document.body,
      )}
    </div>
  )
}
