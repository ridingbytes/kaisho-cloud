import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  addInboxItem,
  deleteInboxItem,
  getInboxItems,
  updateInboxItem,
} from "../api"
import type { InboxItem } from "../types"
import {
  formatShortDate,
  formatFullDate,
} from "../utils/formatDate"
import { Markdown } from "./Markdown"

/** Strip markdown syntax for plain-text preview. */
function stripMd(text: string): string {
  return text
    .replace(/\\n/g, " ")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\n+/g, " ")
    .trim()
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    EMAIL: "badge-email",
    LEAD: "badge-lead",
    IDEA: "badge-idea",
    NOTE: "badge-note",
  }
  return (
    <span className={
      "inbox-type-badge " + (colors[type] || "badge-note")
    }>
      {type}
    </span>
  )
}

function InboxItemRow({
  item,
  onDelete,
  onSelect,
}: {
  item: InboxItem
  onDelete: (item: InboxItem) => void
  onSelect: (item: InboxItem) => void
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

  const created = item.created_at
    ? formatShortDate(item.created_at)
    : ""

  return (
    <div
      className={"inbox-row" + (swiped ? " swiped" : "")}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={() => !swiped && onSelect(item)}
      style={{ cursor: "pointer" }}
    >
      <div className="inbox-row-content">
        <div className="inbox-row-header">
          <TypeBadge type={item.type} />
          {item.customer && (
            <span className="inbox-customer">
              {item.customer}
            </span>
          )}
          <span className="inbox-date">{created}</span>
        </div>
        <p className="inbox-title">{item.title}</p>
        {item.body && (
          <p className="inbox-body">
            {stripMd(item.body).slice(0, 120)}
            {item.body.length > 120 ? "..." : ""}
          </p>
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
            onDelete(item)
          }}
        >
          {t("inbox.delete")}
        </button>
      )}
    </div>
  )
}

function InboxDetailSheet({
  item,
  onClose,
  onDelete,
  onUpdate,
}: {
  item: InboxItem
  onClose: () => void
  onDelete: (item: InboxItem) => void
  onUpdate: (updates: Partial<InboxItem>) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.title)
  const [body, setBody] = useState(item.body || "")

  const created = item.created_at
    ? formatFullDate(item.created_at)
    : ""

  function handleSave() {
    onUpdate({ title, body })
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
          {item.title}
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
                <TypeBadge type={item.type} />
                {item.customer && (
                  <span className="inbox-customer">
                    {item.customer}
                  </span>
                )}
                {created && (
                  <span className="inbox-date">
                    {created}
                  </span>
                )}
              </div>
            </div>

            {item.body && (
              <div className="detail-field">
                <div className="detail-label">
                  {t("detail.description")}
                </div>
                <Markdown>{item.body}</Markdown>
              </div>
            )}

            <button
              className="detail-delete-btn"
              onClick={() => {
                onDelete(item)
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

export function InboxView() {
  const { t } = useTranslation()
  const [items, setItems] = useState<InboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState("")
  const [msg, setMsg] = useState("")
  const [selected, setSelected] =
    useState<InboxItem | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    try {
      const data = await getInboxItems()
      setItems(
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
    const val = text.trim()
    if (!val) return
    try {
      await addInboxItem({ title: val })
      setText("")
      setMsg(t("inbox.captured"))
      setTimeout(() => {
        setMsg("")
        inputRef.current?.focus()
      }, 1500)
      refresh()
    } catch {
      setMsg(t("inbox.captureError"))
      setTimeout(() => setMsg(""), 3000)
    }
  }

  async function handleUpdate(
    item: InboxItem,
    updates: Partial<InboxItem>,
  ) {
    try {
      await updateInboxItem(item, updates)
      const updated = { ...item, ...updates }
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? updated : i
        ),
      )
      setSelected(updated)
    } catch {
      // ignore
    }
  }

  async function handleDelete(item: InboxItem) {
    try {
      await deleteInboxItem(item)
      setItems((prev) =>
        prev.filter((i) => i.id !== item.id),
      )
    } catch {
      // ignore
    }
  }

  return (
    <div className="inbox-view">
      <form
        className="inbox-capture"
        onSubmit={handleSubmit}
      >
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("inbox.placeholder")}
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

      {msg && (
        <p className="inbox-msg">{msg}</p>
      )}

      {loading ? (
        <p className="inbox-empty">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="inbox-empty">{t("inbox.empty")}</p>
      ) : (
        <div className="inbox-list">
          {items.map((item) => (
            <InboxItemRow
              key={item.id}
              item={item}
              onDelete={handleDelete}
              onSelect={setSelected}
            />
          ))}
        </div>
      )}

      {selected && (
        <InboxDetailSheet
          item={selected}
          onClose={() => setSelected(null)}
          onDelete={handleDelete}
          onUpdate={(updates) =>
            handleUpdate(selected, updates)
          }
        />
      )}
    </div>
  )
}
