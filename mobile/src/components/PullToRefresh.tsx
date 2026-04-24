import {
  useRef, useState, useCallback,
} from "react"

/**
 * Pull-to-refresh wrapper for iOS PWA.
 *
 * Detects downward pull when scrolled to the top and
 * triggers a page reload after a threshold is reached.
 * Shows a visual indicator during the pull.
 */
export function PullToRefresh({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const [pulling, setPulling] = useState(false)
  const [offset, setOffset] = useState(0)
  const startY = useRef(0)
  const active = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const THRESHOLD = 80

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const el = containerRef.current
      if (!el || el.scrollTop > 0) return
      startY.current = e.touches[0].clientY
      active.current = true
    },
    [],
  )

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!active.current) return
      const dy = e.touches[0].clientY - startY.current
      if (dy < 0) {
        active.current = false
        setPulling(false)
        setOffset(0)
        return
      }
      const clamped = Math.min(dy * 0.4, 120)
      setOffset(clamped)
      setPulling(clamped > 20)
    },
    [],
  )

  const onTouchEnd = useCallback(() => {
    if (!active.current) return
    active.current = false
    if (offset >= THRESHOLD) {
      setOffset(THRESHOLD)
      window.location.reload()
    } else {
      setPulling(false)
      setOffset(0)
    }
  }, [offset])

  const ready = offset >= THRESHOLD

  return (
    <div
      ref={containerRef}
      className={className}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        position: "relative",
      }}
    >
      {pulling && (
        <div className="ptr-indicator" style={{
          height: offset,
        }}>
          <svg
            className={
              "ptr-spinner"
              + (ready ? " ptr-ready" : "")
            }
            width="20" height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M10 3v6M10 3L7 6M10 3l3 3" />
          </svg>
        </div>
      )}
      {children}
    </div>
  )
}
