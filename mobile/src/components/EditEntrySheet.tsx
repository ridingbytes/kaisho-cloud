import { useEffect, useState } from "react"
import type { ClockEntry, Customer } from "../types"
import {
  getCustomers,
  updateEntry,
  ApiError,
} from "../api"
import { useToast } from "../toast"
import { CustomerPicker } from "./CustomerPicker"
import { ErrorBanner } from "./ErrorBanner"

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
  const [description, setDescription] = useState(
    entry.description || "",
  )
  const [notes, setNotes] = useState(entry.notes || "")
  const [invoiced, setInvoiced] = useState(
    entry.invoiced || false,
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getCustomers()
      .then(setCustomers)
      .catch(() => {})
  }, [])

  const selectedCustomer = customers.find(
    (c) => c.name === customer,
  )
  const contracts = selectedCustomer?.contracts ?? []

  function formatTime(iso: string | null): string {
    if (!iso) return "—"
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const updated = await updateEntry(entry.id, {
        customer: customer || null,
        description,
        contract: contract || null,
        notes,
        invoiced,
      })
      toast("Entry updated")
      onSaved(updated)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError("Failed to save")
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="edit-sheet-backdrop" onClick={onClose}>
      <div
        className="edit-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="edit-sheet-header">
          <h3>Edit entry</h3>
          <button
            type="button"
            className="edit-sheet-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </header>

        <div className="edit-sheet-body">
          <ErrorBanner
            message={error}
            onDismiss={() => setError(null)}
          />

          {/* Read-only time info */}
          <div className="edit-sheet-time">
            <span>{formatDate(entry.start)}</span>
            <span>
              {formatTime(entry.start)}
              {" – "}
              {entry.end ? formatTime(entry.end) : "now"}
            </span>
          </div>

          {/* Editable fields */}
          <div className="form">
            <label className="edit-sheet-label">
              Customer
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
                  Contract
                </label>
                <select
                  value={contract}
                  onChange={(e) =>
                    setContract(e.target.value)
                  }
                >
                  <option value="">None</option>
                  {contracts.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label className="edit-sheet-label">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) =>
                setDescription(e.target.value)
              }
              placeholder="Description"
            />

            <label className="edit-sheet-label">
              Notes
            </label>
            <textarea
              className="edit-sheet-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Free-form notes"
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
              <span>Invoiced</span>
            </label>
          </div>
        </div>

        <footer className="edit-sheet-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </footer>
      </div>
    </div>
  )
}
