import { useEffect, useState } from "react"
import { useAuth } from "../auth"
import { useToast } from "../toast"
import { useTheme } from "../theme"
import type { Theme } from "../theme"
import {
  createCheckout,
  createPortalSession,
  getSubscription,
  regenerateApiKey,
  ApiError,
} from "../api"
import { ErrorBanner } from "./ErrorBanner"
import { planLabel } from "../utils/planLabel"

const THEME_OPTIONS: { id: Theme; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
]

export function ProfileView() {
  const { user, logout } = useAuth()
  const { toast } = useToast()
  const { theme, setTheme } = useTheme()
  const [newKey, setNewKey] = useState<string | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sub, setSub] = useState<{
    plan: string
    subscription?: {
      current_period_end: number
      cancel_at_period_end: boolean
      status: string
    } | null
  } | null>(null)
  const [upgrading, setUpgrading] = useState(false)

  function refreshSub() {
    getSubscription()
      .then(setSub)
      .catch((e) => console.warn("subscription:", e))
  }

  useEffect(() => { refreshSub() }, [])

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

  const plan = sub?.plan || user?.plan || "free"
  const isPaid = plan === "sync" || plan === "sync_ai"

  async function handleUpgrade(
    target: "sync" | "sync_ai",
  ) {
    if (upgrading) return
    setUpgrading(true)
    setError(null)
    try {
      const result = await createCheckout(target)
      if (result.url) {
        window.open(result.url, "_blank")
      } else if (result.success) {
        toast(`Upgraded to ${planLabel(target)}`)
        refreshSub()
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      }
    } finally {
      setUpgrading(false)
    }
  }

  async function handleManage() {
    setError(null)
    try {
      const { url } = await createPortalSession()
      if (url) window.open(url, "_blank")
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      }
    }
  }

  const cloudUrl = window.location.origin
  const cliCmd = newKey
    ? `kai cloud connect ${cloudUrl} ${newKey}`
    : null

  function copyText(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      toast("Copied")
    })
  }

  return (
    <div className="view">
      <ErrorBanner
        message={error}
        onDismiss={() => setError(null)}
      />

      {/* Account */}
      <div className="card">
        <div className="profile-row">
          <span className="text-muted">Email</span>
          <span>{user?.email}</span>
        </div>
        <div className="profile-row">
          <span className="text-muted">Plan</span>
          <span className="plan-badge">{planLabel(plan)}</span>
        </div>
      </div>

      {/* Subscription management */}
      <div className="card">
        <h3>Subscription</h3>
        {isPaid ? (
          <>
            <p className="text-muted">
              You are on the{" "}
              <strong>{planLabel(plan)}</strong> plan.
            </p>
            {sub?.subscription && (
              <div
                className="text-muted"
                style={{ fontSize: 12, marginTop: 8 }}
              >
                <p>
                  Status:{" "}
                  <strong>
                    {sub.subscription.status}
                  </strong>
                </p>
                <p>
                  Renews:{" "}
                  {new Date(
                    sub.subscription
                      .current_period_end * 1000,
                  ).toLocaleDateString()}
                </p>
                {sub.subscription
                  .cancel_at_period_end && (
                  <p style={{ color: "#ef4444" }}>
                    Cancels at end of period
                  </p>
                )}
              </div>
            )}
            <div
              className="upgrade-actions"
              style={{ marginTop: 12 }}
            >
              {plan === "sync" && (
                <button
                  type="button"
                  className="btn-primary upgrade-btn"
                  onClick={() =>
                    handleUpgrade("sync_ai")
                  }
                  disabled={upgrading}
                >
                  {upgrading
                    ? "Upgrading..."
                    : "Upgrade to Sync + AI"}
                </button>
              )}
              <button
                type="button"
                className="btn-secondary upgrade-btn"
                onClick={handleManage}
              >
                Manage Subscription
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted">
              Upgrade to sync time entries with your
              desktop app and unlock AI features.
            </p>
            <div className="upgrade-actions">
              <button
                type="button"
                className="btn-primary upgrade-btn"
                onClick={() => handleUpgrade("sync")}
                disabled={upgrading}
              >
                {upgrading
                  ? "Processing..."
                  : "Cloud Sync"}
              </button>
              <button
                type="button"
                className="btn-secondary upgrade-btn"
                onClick={() =>
                  handleUpgrade("sync_ai")
                }
                disabled={upgrading}
              >
                {upgrading
                  ? "Processing..."
                  : "Sync + AI"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Connect desktop app */}
      <div className="card">
        <h3>Connect desktop app</h3>
        <p className="text-muted">
          Generate an API key to connect your local
          Kaisho instance. The old key will stop working.
        </p>
        <button
          className="btn-secondary"
          onClick={handleRegenerate}
          disabled={loading}
        >
          {loading ? "..." : "Generate new key"}
        </button>
        {newKey && (
          <div className="connect-card">
            <div className="connect-section">
              <span className="connect-label">
                API Key
              </span>
              <code className="api-key-display">
                {newKey}
              </code>
              <button
                className="btn-secondary"
                onClick={copyKey}
              >
                {copied ? "Copied" : "Copy key"}
              </button>
            </div>
            <div className="connect-section">
              <span className="connect-label">
                CLI command
              </span>
              <code className="api-key-display">
                {cliCmd}
              </code>
              <button
                className="btn-secondary"
                onClick={() =>
                  copyText(cliCmd!)
                }
              >
                Copy command
              </button>
            </div>
            <div className="connect-section">
              <span className="connect-label">
                Or manually
              </span>
              <p className="text-muted">
                Open Kaisho &rarr; Settings &rarr;
                Cloud Sync &rarr; paste the URL
                and API key &rarr; Connect.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Appearance */}
      <div className="card">
        <h3>Appearance</h3>
        <div className="segmented">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={
                "segmented-btn" +
                (theme === opt.id
                  ? " segmented-btn--active" : "")
              }
              onClick={() => setTheme(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
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
