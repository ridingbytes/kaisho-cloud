import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "../auth"
import { useToast } from "../toast"
import { Logo } from "./Logo"

export function SignupSuccess() {
  const { t } = useTranslation()
  const { signupResult, setAuthView } = useAuth()
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  if (!signupResult) return null

  function copyKey() {
    navigator.clipboard
      .writeText(signupResult!.api_key)
      .then(() => {
        setCopied(true)
        toast(t("signup_success.api_key_copied"))
        setTimeout(() => setCopied(false), 2000)
      })
  }

  return (
    <div className="auth-screen">
      <Logo size={56} className="auth-logo" />
      <h1 className="auth-title">
        {t("signup_success.title")}
      </h1>
      <div className="card api-key-card">
        <p className="text-muted">
          {t("signup_success.description")}
        </p>
        <code className="api-key-display">
          {signupResult.api_key}
        </code>
        <button
          className="btn-primary"
          onClick={copyKey}
        >
          {copied
            ? t("signup_success.copied")
            : t("signup_success.copy")}
        </button>
      </div>
      <div className="auth-links">
        <button
          className="link-btn"
          onClick={() => setAuthView("login")}
        >
          {t("signup_success.continue")}
        </button>
      </div>
    </div>
  )
}
