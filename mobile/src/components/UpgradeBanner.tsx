import { useState } from "react"
import { createCheckout, ApiError } from "../api"

interface Props {
  message?: string
}

/**
 * Inline banner shown when a feature requires a paid
 * plan. Offers one-tap upgrade via Stripe checkout.
 */
export function UpgradeBanner({
  message = "This feature requires a subscription.",
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleUpgrade(
    plan: "sync" | "sync_ai",
  ) {
    setLoading(true)
    setError("")
    try {
      const { url } = await createCheckout(plan)
      if (url) window.open(url, "_blank")
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError("Could not open checkout")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="upgrade-banner">
      <p className="upgrade-msg">{message}</p>
      <div className="upgrade-actions">
        <button
          type="button"
          className="btn-primary upgrade-btn"
          onClick={() => handleUpgrade("sync")}
          disabled={loading}
        >
          Cloud Sync
        </button>
        <button
          type="button"
          className="btn-secondary upgrade-btn"
          onClick={() => handleUpgrade("sync_ai")}
          disabled={loading}
        >
          Sync + AI
        </button>
      </div>
      {error && (
        <p className="upgrade-error">{error}</p>
      )}
    </div>
  )
}
