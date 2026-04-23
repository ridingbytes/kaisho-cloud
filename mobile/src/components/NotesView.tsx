import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { Note } from "../types"

interface NotesResponse {
  entries: Note[]
}

async function fetchNotes(): Promise<Note[]> {
  const res = await fetch(
    "/sync/notes/changes"
      + "?since=1970-01-01T00:00:00Z&limit=500",
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
      },
    },
  )
  if (!res.ok) return []
  const data: NotesResponse = await res.json()
  return (data.entries || []).filter(
    (e) => !e.deleted_at,
  )
}

async function createNote(title: string, body: string) {
  const id = crypto.randomUUID().slice(0, 12)
  const now = new Date().toISOString()
  await fetch("/sync/notes/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
    },
    body: JSON.stringify({
      entries: [{
        id,
        customer: "",
        title,
        body,
        tags: [],
        task_id: null,
        created_at: now,
        updated_at: now,
      }],
    }),
  })
}

function NoteRow({ note }: { note: Note }) {
  const [expanded, setExpanded] = useState(false)
  const created = note.created_at
    ? new Date(note.created_at).toLocaleDateString(
        undefined, { month: "short", day: "numeric" },
      )
    : ""

  return (
    <div
      className="note-row"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="note-row-header">
        {note.customer && (
          <span className="inbox-customer">
            {note.customer}
          </span>
        )}
        <span className="inbox-date">{created}</span>
      </div>
      <p className="task-title">{note.title}</p>
      {expanded && note.body && (
        <p className="note-body-expanded">{note.body}</p>
      )}
    </div>
  )
}

export function NotesView() {
  const { t } = useTranslation()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState("")
  const [msg, setMsg] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    try {
      const data = await fetchNotes()
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
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const val = title.trim()
    if (!val) return
    try {
      await createNote(val, "")
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
        <p className="inbox-empty">{t("common.loading")}</p>
      ) : notes.length === 0 ? (
        <p className="inbox-empty">{t("notes.empty")}</p>
      ) : (
        <div className="inbox-list">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} />
          ))}
        </div>
      )}
    </div>
  )
}
