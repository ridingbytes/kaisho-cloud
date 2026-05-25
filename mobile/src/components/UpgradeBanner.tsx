import { useState } from "react"
import { useTranslation } from "react-i18next"
import { createCheckout, ApiError } from "../api"

interface Props {
  message?: string
}

/**
 * Inline banner shown when a feature requires a paid plan.
 * Offers a one-tap upgrade to Companion (the entry tier);
 * the full tier picker lives in the Profile screen.
 */
export function UpgradeBanner({ message }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const displayMessage =
    message ?? t("upgrade_banner.default_message")

  async function handleUpgrade() {
    setBusy(true)
    setError(null)
    try {
      const res = await createCheckout("companion")
      if (res.url) {
        window.location.href = res.url
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      }
      setBusy(false)
    }
  }

  return (
    <div className="upgrade-banner">
      <p className="upgrade-msg">{displayMessage}</p>
      <button
        type="button"
        className="btn-primary upgrade-btn"
        onClick={handleUpgrade}
        disabled={busy}
      >
        {busy
          ? t("upgrade_banner.redirecting")
          : t("upgrade_banner.subscribe_companion")}
      </button>
      {error && (
        <p className="upgrade-error">{error}</p>
      )}
    </div>
  )
}
