import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "../auth"
import { forgotPassword, ApiError } from "../api"
import { ErrorBanner } from "./ErrorBanner"
import { Logo } from "./Logo"

export function ForgotPassword() {
  const { t } = useTranslation()
  const { setAuthView } = useAuth()
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(
    null,
  )
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await forgotPassword(email)
      setSent(true)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError(t("auth.error_generic"))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-screen">
      <Logo size={56} className="auth-logo" />
      <h1 className="auth-title">
        {t("forgot.title")}
      </h1>
      {sent ? (
        <div className="card">
          <p className="text-muted">
            {t("forgot.sent")}
          </p>
        </div>
      ) : (
        <form
          className="auth-form"
          onSubmit={handleSubmit}
        >
          <ErrorBanner
            message={error}
            onDismiss={() => setError(null)}
          />
          <p className="text-muted">
            {t("forgot.description")}
          </p>
          <input
            type="email"
            placeholder={t("auth.email")}
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
            required
            autoComplete="email"
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
          >
            {loading ? "..." : t("forgot.send_link")}
          </button>
        </form>
      )}
      <div className="auth-links">
        <button
          className="link-btn"
          onClick={() => setAuthView("login")}
        >
          {t("forgot.back_to_login")}
        </button>
      </div>
    </div>
  )
}
