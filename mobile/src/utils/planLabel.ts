/** Map plan identifiers to human-readable labels. */
const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  sync: "Cloud Sync",
  sync_ai: "Sync + AI",
}

export function planLabel(plan: string): string {
  return PLAN_LABELS[plan] || plan
}
