import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  getAppConfig,
  getSyncedNotes,
  addSyncedNote,
  deleteSyncedNote,
  updateSyncedNote,
} from "../api"
import type { AppConfig } from "../api"
import type { Note } from "../types"
import {
  formatShortDate,
  formatFullDate,
} from "../utils/formatDate"
import { Markdown } from "./Markdown"
import { TagEditor } from "./TagEditor"

function NoteRow({
  note,
  onDelete,
  onSelect,
}: {
  note: Note
  onDelete: (note: Note) => void
  onSelect: (note: Note) => void
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
}: {
  note: Note
  onClose: () => void
  onDelete: (note: Note) => void
  onUpdate: (updates: Partial<Note>) => void
  config: AppConfig
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body || "")
  const [tags, setTags] = useState(note.tags || [])

  const created = note.created_at
    ? formatFullDate(note.created_at)
    : ""

  function handleSave() {
    onUpdate({ title, body, tags })
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
  }, [])

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
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("notes.addPlaceholder")}
          className="inbox-input"
        />
        <button
          type="submit"
          disabled={!title.trim()}
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
        <p className="inbox-empty">
          {t("entries.loading")}
        </p>
      ) : notes.length === 0 ? (
        <p className="inbox-empty">{t("notes.empty")}</p>
      ) : (
        <div className="inbox-list">
          {notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              onDelete={handleDelete}
              onSelect={setSelected}
            />
          ))}
        </div>
      )}

      {selected && (
        <NoteDetailSheet
          note={selected}
          onClose={() => setSelected(null)}
          onDelete={handleDelete}
          onUpdate={(updates) =>
            handleUpdate(selected, updates)
          }
          config={config}
        />
      )}
    </div>
  )
}
