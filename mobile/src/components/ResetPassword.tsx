import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "../auth"
import { useToast } from "../toast"
import { resetPassword, ApiError } from "../api"
import { ErrorBanner } from "./ErrorBanner"
import { Logo } from "./Logo"

export function ResetPassword({
  token,
}: {
  token: string
}) {
  const { t } = useTranslation()
  const { setAuthView } = useAuth()
  const { toast } = useToast()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(
    null,
  )
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError(t("reset.error.too_short"))
      return
    }
    if (password !== confirm) {
      setError(t("reset.error.mismatch"))
      return
    }
    setLoading(true)
    try {
      await resetPassword(token, password)
      toast(t("reset.updated"))
      setAuthView("login")
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError(t("reset.error_generic"))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-screen">
      <Logo size={56} className="auth-logo" />
      <h1 className="auth-title">
        {t("reset.title")}
      </h1>
      <form
        className="auth-form"
        onSubmit={handleSubmit}
      >
        <ErrorBanner
          message={error}
          onDismiss={() => setError(null)}
        />
        <input
          type="password"
          placeholder={t("reset.new_password")}
          value={password}
          onChange={(e) =>
            setPassword(e.target.value)
          }
          required
          minLength={8}
          autoComplete="new-password"
        />
        <input
          type="password"
          placeholder={t("reset.confirm_password")}
          value={confirm}
          onChange={(e) =>
            setConfirm(e.target.value)
          }
          required
          minLength={8}
          autoComplete="new-password"
        />
        <button
          type="submit"
          className="btn-primary"
          disabled={loading}
        >
          {loading ? "..." : t("reset.submit")}
        </button>
      </form>
      <div className="auth-links">
        <button
          className="link-btn"
          onClick={() => setAuthView("login")}
        >
          {t("reset.back_to_login")}
        </button>
      </div>
    </div>
  )
}
