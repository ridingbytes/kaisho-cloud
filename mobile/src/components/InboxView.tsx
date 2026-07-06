import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  addInboxItem,
  deleteInboxItem,
  getAppConfig,
  getCustomers,
  getInboxItems,
  updateInboxItem,
} from "../api"
import type { AppConfig } from "../api"
import type { Customer, InboxItem } from "../types"
import {
  formatShortDate,
  formatFullDate,
} from "../utils/formatDate"
import { SearchBar } from "./SearchBar"
import { SwipeToReveal } from "./SwipeToReveal"
import { Markdown } from "./Markdown"
import { DetailScreen } from "./DetailScreen"
import { useConfirm } from "./ConfirmDialog"
import { Field, FieldRow, Select } from "./Field"

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
  const created = item.created_at
    ? formatShortDate(item.created_at)
    : ""

  return (
    <SwipeToReveal
      className="inbox-row"
      onClick={() => onSelect(item)}
      revealAction={
        <button
          className="inbox-delete-btn"
          style={{ flex: 1 }}
          onClick={(e) => {
            e.stopPropagation()
            onDelete(item)
          }}
        >
          {t("inbox.delete")}
        </button>
      }
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
      <span className="row-chevron">&#8250;</span>
    </SwipeToReveal>
  )
}

const INBOX_TYPES = [
  "NOTE", "IDEA", "EMAIL", "LEAD",
]
const DIRECTIONS = ["in", "out"]

function InboxDetailSheet({
  item,
  onClose,
  onUpdate,
  onDelete,
  customers,
}: {
  item: InboxItem
  onClose: () => void
  onUpdate: (updates: Partial<InboxItem>) => void
  onDelete: () => void
  customers: Customer[]
}) {
  const { t } = useTranslation()
  const [confirm, confirmDialog] = useConfirm()
  const [editing, setEditing] = useState(false)
  const [itemType, setItemType] = useState(
    item.type || "NOTE",
  )
  const [customer, setCustomer] = useState(
    item.customer || "",
  )
  const [title, setTitle] = useState(item.title)
  const [channel, setChannel] = useState(
    item.channel || "",
  )
  const [direction, setDirection] = useState(
    item.direction || "in",
  )
  const [body, setBody] = useState(item.body || "")

  const created = item.created_at
    ? formatFullDate(item.created_at)
    : ""

  function cancelEdit() {
    setItemType(item.type || "NOTE")
    setCustomer(item.customer || "")
    setTitle(item.title)
    setChannel(item.channel || "")
    setDirection(item.direction || "in")
    setBody(item.body || "")
    setEditing(false)
  }

  function handleSave() {
    onUpdate({
      type: itemType,
      customer,
      title,
      channel,
      direction,
      body,
    })
    setEditing(false)
  }

  async function handleDelete() {
    const ok = await confirm(t("inbox.confirmDelete"))
    if (ok) onDelete()
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
    <>
    <DetailScreen
      title={item.title}
      backLabel={t("shell.tab.inbox")}
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

          <FieldRow>
            <Field label={t("detail.type")}>
              <Select value={itemType} onChange={setItemType}>
                {INBOX_TYPES.map((tp) => (
                  <option key={tp} value={tp}>
                    {tp}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("detail.direction")}>
              <Select
                value={direction}
                onChange={setDirection}
              >
                {DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

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

          <Field label={t("detail.description")} grow>
            <textarea
              className="field-control"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
            />
          </Field>

          <Field label={t("detail.channel")}>
            <input
              className="field-control"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="email, phone, chat..."
            />
          </Field>

          <button
            type="button"
            className="btn-danger ds-delete"
            onClick={handleDelete}
          >
            {t("detail.delete")}
          </button>
        </div>
      ) : (
        <div className="ds-content">
          <div className="view-hero">
            <div className="view-hero-title">
              {item.title}
            </div>
            <div className="view-pills">
              <TypeBadge type={item.type} />
              {item.customer && (
                <span className="inbox-customer">
                  {item.customer}
                </span>
              )}
            </div>
          </div>

          <div className="view-section">
            {item.channel && (
              <div className="view-row">
                <span className="view-row-label">
                  {t("detail.channel")}
                </span>
                <span className="view-row-value">
                  {item.channel}
                </span>
              </div>
            )}
            {item.direction && (
              <div className="view-row">
                <span className="view-row-label">
                  {t("detail.direction")}
                </span>
                <span className="view-row-value">
                  {item.direction}
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
          </div>

          {item.body && (
            <div>
              <div className="view-block-label">
                {t("detail.description")}
              </div>
              <div className="view-body">
                <Markdown>{item.body}</Markdown>
              </div>
            </div>
          )}
        </div>
      )}
    </DetailScreen>
    {confirmDialog}
    </>
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
  const [customers, setCustomers] =
    useState<Customer[]>([])
  const [config, setConfig] = useState<AppConfig>({
    tags: [], github_configured: false,
  })
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState("")
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
    getCustomers()
      .then(setCustomers)
      .catch(() => {})
    getAppConfig()
      .then(setConfig)
      .catch(() => {})
  }, [])

  const filtered = searchText
    ? items.filter((item) => {
        const q = searchText.toLowerCase()
        return [
          item.title, item.body, item.customer,
        ].join(" ").toLowerCase().includes(q)
      })
    : items

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
        {!searchOpen && (
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("inbox.placeholder")}
            className="inbox-input"
          />
        )}
        <SearchBar
          searchText={searchText}
          onSearchChange={setSearchText}
          activeTags={[]}
          onTagToggle={() => {}}
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

      {msg && (
        <p className="inbox-msg">{msg}</p>
      )}

      {loading ? (
        <p className="inbox-empty">
          {t("common.loading")}
        </p>
      ) : filtered.length === 0 ? (
        <p className="inbox-empty">
          {t("inbox.empty")}
        </p>
      ) : (
        <div className="inbox-list">
          {filtered.map((item) => (
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
          onUpdate={(updates) =>
            handleUpdate(selected, updates)
          }
          onDelete={async () => {
            await handleDelete(selected)
            setSelected(null)
          }}
          customers={customers}
        />
      )}
    </div>
  )
}
