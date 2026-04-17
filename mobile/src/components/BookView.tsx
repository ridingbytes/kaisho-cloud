import { useEffect, useState } from "react"
import type { Customer } from "../types"
import {
  getCustomers,
  quickBook,
  ApiError,
} from "../api"
import { useToast } from "../toast"
import { ErrorBanner } from "./ErrorBanner"
import { CustomerPicker } from "./CustomerPicker"

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

export function BookView() {
  const { toast } = useToast()
  const [customers, setCustomers] = useState<Customer[]>(
    [],
  )
  const [customer, setCustomer] = useState("")
  const [duration, setDuration] = useState("")
  const [desc, setDesc] = useState("")
  const [date, setDate] = useState(todayStr())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getCustomers()
      .then(setCustomers)
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await quickBook({
        duration,
        customer: customer || undefined,
        description: desc,
        date: date || undefined,
      })
      toast("Entry booked")
      setDuration("")
      setDesc("")
      setDate(todayStr())
    } catch (err) {
      if (err instanceof ApiError) {
        if (
          err.status === 403 &&
          err.message.toLowerCase()
            .includes("plan")
        ) {
          setError(
            "Plan upgrade required to use this feature",
          )
        } else {
          setError(err.message)
        }
      } else {
        setError("Something went wrong")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="view">
      <form className="card form" onSubmit={handleSubmit}>
        <ErrorBanner
          message={error}
          onDismiss={() => setError(null)}
        />
        <input
          type="text"
          placeholder="Duration (e.g. 1h30m, 90m, 1.5)"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          required
        />
        <CustomerPicker
          value={customer}
          customers={customers}
          onChange={setCustomer}
          placeholder="Customer"
          synced={customers.length > 0}
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button
          type="submit"
          className="btn-primary"
          disabled={loading}
        >
          {loading ? "..." : "Book entry"}
        </button>
      </form>
    </div>
  )
}
