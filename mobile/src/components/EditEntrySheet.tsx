import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type {
  ClockEntry, Customer, TaskRef,
} from "../types"
import {
  getCustomers,
  getTasks,
  updateEntry,
  ApiError,
} from "../api"
import { useToast } from "../toast"
import { CustomerPicker } from "./CustomerPicker"
import { ErrorBanner } from "./ErrorBanner"
import { formatDate } from "../utils/time"

/**
 * Props for the EditEntrySheet.
 *
 * @param entry - The clock entry to edit.
 * @param onClose - Called when the sheet is dismissed
 *   (cancel or after save).
 * @param onSaved - Called with the updated entry after
 *   a successful save.
 */
interface Props {
  entry: ClockEntry
  onClose: () => void
  onSaved: (updated: ClockEntry) => void
}

/**
 * Bottom-sheet style editor for a clock entry.
 *
 * Opens as a full-screen overlay on mobile. The user
 * can edit customer, contract, description, notes, and
 * the invoiced flag. Times are displayed read-only
 * (editing start/end requires the desktop app).
 */
export function EditEntrySheet(props: Props) {
  const { entry, onClose, onSaved } = props
  const { t } = useTranslation()
  const { toast } = useToast()
  const [customers, setCustomers] = useState<Customer[]>(
    [],
  )
  const [customer, setCustomer] = useState(
    entry.customer || "",
  )
  const [contract, setContract] = useState(
    entry.contract || "",
  )
  const [taskId, setTaskId] = useState(
    entry.task_id || "",
  )
  const [tasks, setTasks] = useState<TaskRef[]>([])
  const [description, setDescription] = useState(
    entry.description || "",
  )
  const [notes, setNotes] = useState(entry.notes || "")
  const [invoiced, setInvoiced] = useState(
    entry.invoiced || false,
  )
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(entry.start)
    return d.toTimeString().slice(0, 5)
  })
  const [duration, setDuration] = useState(() => {
    if (!entry.end) return ""
    const ms = new Date(entry.end).getTime() -
      new Date(entry.start).getTime()
    const mins = Math.round(ms / 60000)
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m > 0 ? `${h}h${m}m` : `${h}h`
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getCustomers()
      .then(setCustomers)
      .catch((e) => console.warn("customers:", e))
    getTasks()
      .then(setTasks)
      .catch((e) => console.warn("tasks:", e))
  }, [])

  const selectedCustomer = customers.find(
    (c) => c.name === customer,
  )
  const contracts = selectedCustomer?.contracts ?? []

  function parseDuration(s: string): number | null {
    const m1 = s.match(/^(\d+)\s*h\s*(\d+)\s*m?$/i)
    if (m1) return parseInt(m1[1]) * 60 + parseInt(m1[2])
    const m2 = s.match(/^(\d+)\s*h$/i)
    if (m2) return parseInt(m2[1]) * 60
    const m3 = s.match(/^(\d+)\s*m$/i)
    if (m3) return parseInt(m3[1])
    const m4 = s.match(/^(\d+(?:\.\d+)?)$/)
    if (m4) return Math.round(parseFloat(m4[1]) * 60)
    return null
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      // Compute new timestamps from edited start + duration
      const fields: Record<string, unknown> = {
        customer: customer || null,
        description,
        contract: contract || null,
        task_id: taskId || null,
        notes,
        invoiced,
      }

      if (startTime) {
        const orig = new Date(entry.start)
        const [h, m] = startTime.split(":").map(Number)
        orig.setHours(h, m, 0, 0)
        fields.start_at = orig.toISOString()

        if (duration && entry.end) {
          const mins = parseDuration(duration)
          if (mins && mins > 0) {
            const end = new Date(
              orig.getTime() + mins * 60000,
            )
            fields.end_at = end.toISOString()
          }
        }
      }

      const updated = await updateEntry(
        entry.id,
        fields as Parameters<typeof updateEntry>[1],
      )
      toast(t("edit.saved"))
      onSaved(updated)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError(t("edit.error_save"))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="edit-sheet-backdrop" onClick={onClose}>
      <div
        className="edit-sheet"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="edit-sheet-header">
          <h3>{t("edit.title")}</h3>
          <button
            type="button"
            className="edit-sheet-close"
            onClick={onClose}
            aria-label={t("edit.close")}
          >
            &times;
          </button>
        </header>

        <div className="edit-sheet-body">
          <ErrorBanner
            message={error}
            onDismiss={() => setError(null)}
          />

          {/* Date + editable start time and duration */}
          <div className="edit-sheet-time">
            <span>{formatDate(entry.start)}</span>
          </div>
          <div className="form" style={{ marginTop: 8 }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
            }}>
              <div>
                <label className="edit-sheet-label">
                  {t("edit.label.start")}
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) =>
                    setStartTime(e.target.value)
                  }
                />
              </div>
              {entry.end && (
                <div>
                  <label className="edit-sheet-label">
                    {t("edit.label.duration")}
                  </label>
                  <input
                    type="text"
                    value={duration}
                    onChange={(e) =>
                      setDuration(e.target.value)
                    }
                    placeholder="1h30m"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Editable fields */}
          <div className="form">
            <label className="edit-sheet-label">
              {t("edit.label.customer")}
            </label>
            <CustomerPicker
              value={customer}
              customers={customers}
              onChange={(v) => {
                setCustomer(v)
                setContract("")
              }}
              synced={customers.length > 0}
            />

            {contracts.length > 0 && (
              <>
                <label className="edit-sheet-label">
                  {t("edit.label.contract")}
                </label>
                <select
                  value={contract}
                  onChange={(e) =>
                    setContract(e.target.value)
                  }
                >
                  <option value="">
                    {t("edit.contract.none")}
                  </option>
                  {contracts.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label className="edit-sheet-label">
              {t("edit.label.task")}
            </label>
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
            >
              <option value="">
                {t("edit.task.none")}
              </option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                  {task.customer
                    ? ` (${task.customer})` : ""}
                </option>
              ))}
            </select>

            <label className="edit-sheet-label">
              {t("edit.label.description")}
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) =>
                setDescription(e.target.value)
              }
              placeholder={
                t("edit.description_placeholder")
              }
            />

            <label className="edit-sheet-label">
              {t("edit.label.notes")}
            </label>
            <textarea
              className="edit-sheet-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("edit.notes_placeholder")}
              rows={3}
            />

            <label className="edit-sheet-check">
              <input
                type="checkbox"
                checked={invoiced}
                onChange={(e) =>
                  setInvoiced(e.target.checked)
                }
              />
              <span>{t("edit.label.invoiced")}</span>
            </label>
          </div>
        </div>

        <footer className="edit-sheet-footer">
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
            disabled={saving}
          >
            {saving
              ? t("edit.saving")
              : t("edit.save")}
          </button>
        </footer>
      </div>
    </div>
  )
}
