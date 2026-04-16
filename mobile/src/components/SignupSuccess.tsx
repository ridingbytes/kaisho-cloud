import { useState } from "react"
import { useAuth } from "../auth"
import { useToast } from "../toast"

export function SignupSuccess() {
  const { signupResult, setAuthView } = useAuth()
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  if (!signupResult) return null

  function copyKey() {
    navigator.clipboard
      .writeText(signupResult!.api_key)
      .then(() => {
        setCopied(true)
        toast("API key copied")
        setTimeout(() => setCopied(false), 2000)
      })
  }

  return (
    <div className="auth-screen">
      <img
        src="/m/icon.svg"
        alt="Kaisho"
        className="auth-logo"
      />
      <h1 className="auth-title">Account created</h1>
      <div className="card api-key-card">
        <p className="text-muted">
          Save this API key now. You will need it to
          connect your desktop app. It will not be shown
          again.
        </p>
        <code className="api-key-display">
          {signupResult.api_key}
        </code>
        <button
          className="btn-primary"
          onClick={copyKey}
        >
          {copied ? "Copied" : "Copy API key"}
        </button>
      </div>
      <div className="auth-links">
        <button
          className="link-btn"
          onClick={() => setAuthView("login")}
        >
          Continue to login
        </button>
      </div>
    </div>
  )
}
