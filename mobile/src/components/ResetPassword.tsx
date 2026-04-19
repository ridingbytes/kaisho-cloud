import { useState } from "react"
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
      setError("Password must be at least 8 characters")
      return
    }
    if (password !== confirm) {
      setError("Passwords do not match")
      return
    }
    setLoading(true)
    try {
      await resetPassword(token, password)
      toast("Password updated")
      setAuthView("login")
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError("Something went wrong")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-screen">
      <Logo size={56} className="auth-logo" />
      <h1 className="auth-title">New password</h1>
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
          placeholder="New password"
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
          placeholder="Confirm password"
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
          {loading ? "..." : "Set new password"}
        </button>
      </form>
      <div className="auth-links">
        <button
          className="link-btn"
          onClick={() => setAuthView("login")}
        >
          Back to login
        </button>
      </div>
    </div>
  )
}
