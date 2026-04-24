import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "../auth"
import { useToast } from "../toast"
import { useTheme } from "../theme"
import type { Theme } from "../theme"
import { setLanguage } from "../i18n"
import {
  createCheckout,
  createPortalSession,
  getAppConfig,
  getSubscription,
  regenerateApiKey,
  updateAppConfig,
  aiUsage,
  ApiError,
} from "../api"
import { ErrorBanner } from "./ErrorBanner"
import { planLabel } from "../utils/planLabel"

const LANG_OPTIONS = [
  { id: "en", label: "English" },
  { id: "de", label: "Deutsch" },
  { id: "es", label: "Español" },
]

export function ProfileView() {
  const { t, i18n } = useTranslation()
  const { user, logout } = useAuth()
  const { toast } = useToast()
  const { theme, setTheme } = useTheme()

  const THEME_OPTIONS: { id: Theme; label: string }[] = [
    { id: "light", label: t("profile.theme.light") },
    { id: "dark", label: t("profile.theme.dark") },
    { id: "system", label: t("profile.theme.system") },
  ]
  const [fullName, setFullName] = useState("")
  const [nameLoaded, setNameLoaded] = useState(false)
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
  const [usage, setUsage] = useState<{
    month: string
    input_tokens: number
    output_tokens: number
    total_tokens: number
    request_count: number
    cap: number
  } | null>(null)

  function refreshSub() {
    getSubscription()
      .then(setSub)
      .catch((e) => console.warn("subscription:", e))
  }

  useEffect(() => {
    refreshSub()
    getAppConfig()
      .then((cfg) => {
        setFullName(cfg.user_name || "")
        setNameLoaded(true)
      })
      .catch(() => setNameLoaded(true))
  }, [])

  const plan = sub?.plan || user?.plan || "free"
  const isPaid = plan === "sync" || plan === "sync_ai"

  useEffect(() => {
    if (plan !== "sync_ai") return
    aiUsage()
      .then(setUsage)
      .catch((e) => console.warn("ai usage:", e))
  }, [plan])

  async function handleRegenerate() {
    setError(null)
    setLoading(true)
    try {
      const res = await regenerateApiKey()
      setNewKey(res.api_key)
      toast(t("profile.key_generated"))
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError(t("profile.error_generic"))
      }
    } finally {
      setLoading(false)
    }
  }

  function copyKey() {
    if (!newKey) return
    navigator.clipboard.writeText(newKey).then(() => {
      setCopied(true)
      toast(t("profile.api_key_copied"))
      setTimeout(() => setCopied(false), 2000)
    })
  }

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
      toast(t("profile.copied"))
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
        {nameLoaded && (
          <div className="profile-row">
            <span className="text-muted">
              {t("profile.name")}
            </span>
            <input
              className="profile-name-input"
              value={fullName}
              onChange={(e) =>
                setFullName(e.target.value)
              }
              onBlur={() => {
                updateAppConfig({
                  user_name: fullName.trim(),
                }).catch(() => {})
              }}
              placeholder={t("profile.name")}
            />
          </div>
        )}
        <div className="profile-row">
          <span className="text-muted">
            {t("profile.email")}
          </span>
          <span>{user?.email}</span>
        </div>
        <div className="profile-row">
          <span className="text-muted">
            {t("profile.plan")}
          </span>
          <span className="plan-badge">{planLabel(plan)}</span>
        </div>
      </div>

      {/* Subscription management */}
      <div className="card">
        <h3>{t("profile.subscription")}</h3>
        {isPaid ? (
          <>
            <p className="text-muted">
              {t("profile.subscription.on_plan", {
                plan: planLabel(plan),
              })}
            </p>
            {sub?.subscription && (
              <div
                className="text-muted"
                style={{ fontSize: 12, marginTop: 8 }}
              >
                <p>
                  {t("profile.subscription.status")}{" "}
                  <strong>
                    {sub.subscription.status}
                  </strong>
                </p>
                <p>
                  {t("profile.subscription.renews")}{" "}
                  {new Date(
                    sub.subscription
                      .current_period_end * 1000,
                  ).toLocaleDateString()}
                </p>
                {sub.subscription
                  .cancel_at_period_end && (
                  <p style={{ color: "#ef4444" }}>
                    {t("profile.subscription.cancels")}
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
                    ? t("profile.upgrade.upgrading")
                    : t("profile.upgrade.to_sync_ai")}
                </button>
              )}
              <button
                type="button"
                className="btn-secondary upgrade-btn"
                onClick={handleManage}
              >
                {t("profile.upgrade.manage")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted">
              {t("profile.upgrade.cta")}
            </p>
            <div className="upgrade-actions">
              <button
                type="button"
                className="btn-primary upgrade-btn"
                onClick={() => handleUpgrade("sync")}
                disabled={upgrading}
              >
                {upgrading
                  ? t("profile.upgrade.processing")
                  : t("profile.upgrade.cloud_sync")}
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
                  ? t("profile.upgrade.processing")
                  : t("profile.upgrade.sync_ai")}
              </button>
            </div>
          </>
        )}
      </div>

      {/* AI token usage */}
      {plan === "sync_ai" && usage && (() => {
        const pct = usage.cap > 0
          ? Math.min(
              100,
              (usage.total_tokens / usage.cap) * 100,
            )
          : 0
        const barColor =
          pct >= 90
            ? "#ef4444"
            : pct >= 70
            ? "#f59e0b"
            : "#22c55e"
        const fmtK = (n: number) =>
          (n / 1000).toFixed(1) + "K"
        return (
          <div className="card">
            <h3>{t("profile.ai_usage")}</h3>
            <p
              className="text-muted"
              style={{ fontSize: 12, marginBottom: 8 }}
            >
              {usage.month}
            </p>
            <div
              style={{
                background: "var(--border, #e5e7eb)",
                borderRadius: 4,
                height: 8,
                overflow: "hidden",
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  width: pct + "%",
                  height: "100%",
                  background: barColor,
                  borderRadius: 4,
                  transition: "width 0.3s",
                }}
              />
            </div>
            <p style={{ fontSize: 13, margin: "4px 0" }}>
              {fmtK(usage.total_tokens)}{" "}
              /{" "}
              {fmtK(usage.cap)}{" "}
              {t("profile.ai_usage.tokens")}
            </p>
            <p
              className="text-muted"
              style={{ fontSize: 12 }}
            >
              {usage.request_count !== 1
                ? t(
                  "profile.ai_usage"
                  + ".requests_this_month_plural",
                  { count: usage.request_count },
                )
                : t(
                  "profile.ai_usage"
                  + ".requests_this_month",
                  { count: usage.request_count },
                )}
            </p>
          </div>
        )
      })()}

      {/* Connect desktop app */}
      <div className="card">
        <h3>{t("profile.connect")}</h3>
        <p className="text-muted">
          {t("profile.connect.description")}
        </p>
        <button
          className="btn-secondary"
          onClick={handleRegenerate}
          disabled={loading}
        >
          {loading
            ? t("profile.connect.generating")
            : t("profile.connect.generate")}
        </button>
        {newKey && (
          <div className="connect-card">
            <div className="connect-section">
              <span className="connect-label">
                {t("profile.connect.api_key")}
              </span>
              <code className="api-key-display">
                {newKey}
              </code>
              <button
                className="btn-secondary"
                onClick={copyKey}
              >
                {copied
                  ? t("profile.connect.copied")
                  : t("profile.connect.copy_key")}
              </button>
            </div>
            <div className="connect-section">
              <span className="connect-label">
                {t("profile.connect.cli_command")}
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
                {t("profile.connect.copy_command")}
              </button>
            </div>
            <div className="connect-section">
              <span className="connect-label">
                {t("profile.connect.manual_label")}
              </span>
              <p className="text-muted">
                {t(
                  "profile.connect.manual_instructions",
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Appearance */}
      <div className="card">
        <h3>{t("profile.appearance")}</h3>
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
        <div
          className="segmented"
          style={{ marginTop: 12 }}
        >
          {LANG_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={
                "segmented-btn" +
                (i18n.language === opt.id
                  ? " segmented-btn--active" : "")
              }
              onClick={() => setLanguage(opt.id)}
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
        {t("profile.logout")}
      </button>
    </div>
  )
}
