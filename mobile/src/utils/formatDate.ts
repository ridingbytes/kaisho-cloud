export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric" },
  )
}

export function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleDateString(
    undefined,
    { year: "numeric", month: "short", day: "numeric" },
  )
}
