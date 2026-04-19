import { useState } from "react"
import { useAuth } from "../auth"
import { useToast } from "../toast"
import { ErrorBanner } from "./ErrorBanner"
import { Logo } from "./Logo"
import { ApiError } from "../api"

export function LoginForm() {
  const { login, signup, setAuthView } = useAuth()
  const { toast } = useToast()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<"login" | "signup">(
    "login",
  )

  async function handleSubmit(
    e: React.FormEvent,
  ) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (mode === "login") {
        await login(email, password)
        toast("Logged in")
      } else {
        await signup(email, password)
      }
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
      <h1 className="auth-title">Kaisho</h1>
      <form className="auth-form" onSubmit={handleSubmit}>
        <ErrorBanner
          message={error}
          onDismiss={() => setError(null)}
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete={
            mode === "login"
              ? "current-password"
              : "new-password"
          }
        />
        <button
          type="submit"
          className="btn-primary"
          disabled={loading}
        >
          {loading
            ? "..."
            : mode === "login"
              ? "Log in"
              : "Sign up"}
        </button>
      </form>
      <div className="auth-links">
        <button
          className="link-btn"
          onClick={() =>
            setMode(
              mode === "login" ? "signup" : "login",
            )
          }
        >
          {mode === "login"
            ? "Create account"
            : "Back to login"}
        </button>
        {mode === "login" && (
          <button
            className="link-btn"
            onClick={() =>
              setAuthView("forgot-password")
            }
          >
            Forgot password?
          </button>
        )}
      </div>
    </div>
  )
}
