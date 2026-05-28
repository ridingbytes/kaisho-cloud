import { PAID_PLANS } from "./planLabel"

/**
 * Deep-link upgrade plumbing for the marketing-site CTAs.
 *
 * When a user clicks "Start Companion" or "Start Pro" on
 * kaisho.dev they land here with `?upgrade=<plan>`. We
 * stash the plan in localStorage and strip the param so a
 * reload does not fire again, then resume the intent once
 * the user is authenticated by triggering `createCheckout`.
 *
 * Anything outside PAID_PLANS is ignored so stale or
 * malformed links cannot drive arbitrary requests.
 */

type PaidPlan = "companion" | "pro" | "team"

const STORAGE_KEY = "kaisho:pending-upgrade"
const URL_PARAM = "upgrade"

function isPaidPlan(value: unknown): value is PaidPlan {
  return (
    typeof value === "string" &&
    PAID_PLANS.includes(value)
  )
}

/**
 * Read `?upgrade=<plan>` from the URL (if any), validate it
 * against PAID_PLANS, persist a valid value to localStorage
 * for later consumption, and strip the param so a reload or
 * post-login navigation does not re-fire the intent.
 */
export function captureUpgradeFromUrl(): void {
  if (typeof window === "undefined") return
  const params = new URLSearchParams(window.location.search)
  const plan = params.get(URL_PARAM)
  if (isPaidPlan(plan)) {
    localStorage.setItem(STORAGE_KEY, plan)
  }
  // Strip the param even when invalid so a stale value
  // does not sit in the URL across navigations.
  if (params.has(URL_PARAM)) {
    params.delete(URL_PARAM)
    const qs = params.toString()
    const next =
      window.location.pathname +
      (qs ? "?" + qs : "") +
      window.location.hash
    window.history.replaceState({}, "", next)
  }
}

/**
 * Pop a previously captured plan, if any. Always removes
 * the entry from storage on read so a cancelled or failed
 * checkout does not loop the user.
 *
 * @returns A validated PaidPlan, or null when nothing
 *          actionable is stored.
 */
export function takePendingUpgrade(): PaidPlan | null {
  if (typeof window === "undefined") return null
  const plan = localStorage.getItem(STORAGE_KEY)
  if (plan !== null) {
    localStorage.removeItem(STORAGE_KEY)
  }
  return isPaidPlan(plan) ? plan : null
}
