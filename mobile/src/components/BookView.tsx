import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { Customer } from "../types"
import {
  aiParseBooking,
  getCustomers,
  quickBook,
  ApiError,
} from "../api"
import { useAuth } from "../auth"
import { useToast } from "../toast"
import { ErrorBanner } from "./ErrorBanner"
import { CustomerPicker } from "./CustomerPicker"
import { UpgradeBanner } from "./UpgradeBanner"

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

export function BookView() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { toast } = useToast()
  const [customers, setCustomers] = useState<Customer[]>(
    [],
  )
  const [customer, setCustomer] = useState("")
  const [duration, setDuration] = useState("")
  const [desc, setDesc] = useState("")
  const [date, setDate] = useState(todayStr())
  const [smartText, setSmartText] = useState("")
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsUpgrade, setNeedsUpgrade] = useState(false)
  const [loading, setLoading] = useState(false)
  const hasAI = user?.plan === "sync_ai"

  useEffect(() => {
    getCustomers()
      .then(setCustomers)
      .catch((e) => console.warn("load:", e))
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
      toast(t("book.booked"))
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
          setNeedsUpgrade(true)
        } else {
          setError(err.message)
        }
      } else {
        setError(t("book.error_generic"))
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleSmartBook() {
    if (!smartText.trim()) return
    setParsing(true)
    setError(null)
    try {
      const { parsed } = await aiParseBooking(
        smartText.trim(),
      )
      if (parsed.duration) setDuration(parsed.duration)
      if (parsed.customer) setCustomer(parsed.customer)
      if (parsed.description) setDesc(parsed.description)
      if (parsed.date) setDate(parsed.date)
      setSmartText("")
      toast(t("book.parsed"))
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      }
    } finally {
      setParsing(false)
    }
  }

  return (
    <div className="view">
      {/* Smart Book: natural language input (AI plan) */}
      {hasAI && (
        <div className="card form smart-book">
          <div className="smart-book-row">
            <input
              type="text"
              value={smartText}
              onChange={(e) =>
                setSmartText(e.target.value)
              }
              placeholder={t("book.smart_placeholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleSmartBook()
                }
              }}
            />
            <button
              type="button"
              className="btn-primary smart-book-btn"
              onClick={handleSmartBook}
              disabled={parsing || !smartText.trim()}
            >
              {parsing ? "..." : t("book.parse")}
            </button>
          </div>
          <p className="text-muted smart-book-hint">
            {t("book.smart_hint")}
          </p>
        </div>
      )}

      <form className="card form" onSubmit={handleSubmit}>
        <ErrorBanner
          message={error}
          onDismiss={() => setError(null)}
        />
        <input
          type="text"
          placeholder={t("book.duration_placeholder")}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          required
        />
        <CustomerPicker
          value={customer}
          customers={customers}
          onChange={setCustomer}
          placeholder={t("book.customer")}
          synced={customers.length > 0}
        />
        <input
          type="text"
          placeholder={t("book.description_optional")}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        {needsUpgrade ? (
          <UpgradeBanner />
        ) : (
          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
          >
            {loading ? "..." : t("book.submit")}
          </button>
        )}
      </form>
    </div>
  )
}
