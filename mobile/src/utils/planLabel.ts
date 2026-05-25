/** Map plan identifiers to human-readable labels. */
const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  companion: "Companion",
  pro: "Pro",
  team: "Team",
}

/** Paid tiers. Every one includes the AI gateway. */
export const PAID_PLANS = ["companion", "pro", "team"]

export function isPaidPlan(plan?: string | null): boolean {
  return !!plan && PAID_PLANS.includes(plan)
}

export function planLabel(plan: string): string {
  return PLAN_LABELS[plan] || plan
}
