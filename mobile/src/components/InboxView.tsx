import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  addInboxItem,
  deleteInboxItem,
  getInboxItems,
} from "../api"
import type { InboxItem } from "../types"

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
}: {
  item: InboxItem
  onDelete: (item: InboxItem) => void
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
    ? new Date(item.created_at).toLocaleDateString(
        undefined, { month: "short", day: "numeric" },
      )
    : ""

  return (
    <div
      className={"inbox-row" + (swiped ? " swiped" : "")}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
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
          <p className="inbox-body">{item.body}</p>
        )}
      </div>
      {swiped && (
        <button
          className="inbox-delete-btn"
          onClick={() => onDelete(item)}
        >
          {t("inbox.delete")}
        </button>
      )}
    </div>
  )
}

export function InboxView() {
  const { t } = useTranslation()
  const [items, setItems] = useState<InboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState("")
  const [msg, setMsg] = useState("")
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
            />
          ))}
        </div>
      )}
    </div>
  )
}
