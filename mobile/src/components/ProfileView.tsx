import { useState } from "react"
import { useAuth } from "../auth"
import { useToast } from "../toast"
import { regenerateApiKey, ApiError } from "../api"
import { ErrorBanner } from "./ErrorBanner"

export function ProfileView() {
  const { user, logout } = useAuth()
  const { toast } = useToast()
  const [newKey, setNewKey] = useState<string | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleRegenerate() {
    setError(null)
    setLoading(true)
    try {
      const res = await regenerateApiKey()
      setNewKey(res.api_key)
      toast("New API key generated")
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

  function copyKey() {
    if (!newKey) return
    navigator.clipboard.writeText(newKey).then(() => {
      setCopied(true)
      toast("API key copied")
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="view">
      <div className="card">
        <ErrorBanner
          message={error}
          onDismiss={() => setError(null)}
        />
        <div className="profile-row">
          <span className="text-muted">Email</span>
          <span>{user?.email}</span>
        </div>
        <div className="profile-row">
          <span className="text-muted">Plan</span>
          <span className="plan-badge">
            {user?.plan ?? "free"}
          </span>
        </div>
      </div>

      <div className="card">
        <h3>API key</h3>
        <p className="text-muted">
          Generate a new API key for your desktop app.
          The old key will stop working.
        </p>
        {newKey && (
          <div className="api-key-card">
            <code className="api-key-display">
              {newKey}
            </code>
            <button
              className="btn-secondary"
              onClick={copyKey}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
        <button
          className="btn-secondary"
          onClick={handleRegenerate}
          disabled={loading}
        >
          {loading ? "..." : "Generate new key"}
        </button>
      </div>

      <button
        className="btn-danger logout-btn"
        onClick={logout}
      >
        Log out
      </button>
    </div>
  )
}
