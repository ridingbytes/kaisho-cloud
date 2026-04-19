import { useState } from "react"
import { useAuth } from "../auth"
import { forgotPassword, ApiError } from "../api"
import { ErrorBanner } from "./ErrorBanner"
import { Logo } from "./Logo"

export function ForgotPassword() {
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
        setError("Something went wrong")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-screen">
      <Logo size={56} className="auth-logo" />
      <h1 className="auth-title">Reset password</h1>
      {sent ? (
        <div className="card">
          <p className="text-muted">
            If an account exists for that email,
            you will receive a password reset link.
            Check your spam folder if it does not
            arrive within a few minutes.
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
            Enter your email and we will send a
            password reset link.
          </p>
          <input
            type="email"
            placeholder="Email"
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
            {loading ? "..." : "Send reset link"}
          </button>
        </form>
      )}
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
