import { useState } from "react"
import { useAuth } from "../auth"
import { useToast } from "../toast"
import { rotateKey, ApiError } from "../api"
import { ErrorBanner } from "./ErrorBanner"

export function RecoverKey() {
  const { setAuthView } = useAuth()
  const { toast } = useToast()
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await rotateKey(email)
      toast(res.message)
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
      <img
        src="/m/icon.svg"
        alt="Kaisho"
        className="auth-logo"
      />
      <h1 className="auth-title">Recover API key</h1>
      {sent ? (
        <div className="card">
          <p className="text-muted">
            A new API key has been sent to your email.
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
            Enter your email and we will send a new API
            key.
          </p>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
          >
            {loading ? "..." : "Send new key"}
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
