interface LogoProps {
  size?: number
  className?: string
}

/**
 * Kaisho logo: open bracket palm (three vertical lines).
 * Uses currentColor so it adapts to light/dark themes.
 */
export function Logo({ size = 32, className }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-label="Kaisho"
    >
      <path
        d="M 10 5 L 5 5 L 5 27 L 10 27"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <line
        x1="13" y1="10" x2="13" y2="22"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <line
        x1="19" y1="8" x2="19" y2="24"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <line
        x1="25" y1="11" x2="25" y2="21"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  )
}
