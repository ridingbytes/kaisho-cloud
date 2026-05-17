import {
  useEffect, useRef, useState, type ReactNode,
} from "react"

interface Props {
  /** Content shown beneath when swiped open. */
  revealAction: ReactNode
  /** Width of the revealed action panel in pixels. */
  actionWidth?: number
  /** Row content. */
  children: ReactNode
  /** Forwarded to the row element. */
  className?: string
  /** Forwarded to the row element. */
  onClick?: () => void
}

const OPEN_THRESHOLD = 40
const AXIS_LOCK = 8

/**
 * Swipe-to-reveal wrapper for mobile rows.
 *
 * Swiping the content left exposes the ``revealAction``
 * panel on the right. The wrapper locks to the horizontal
 * axis only after the touch travels ``AXIS_LOCK`` px, so
 * vertical scrolls and pull-to-refresh pass through. Tap
 * outside the row, or tap the row while open, closes the
 * panel without firing the row's ``onClick``.
 */
export function SwipeToReveal({
  revealAction,
  actionWidth = 80,
  children,
  className,
  onClick,
}: Props) {
  const [open, setOpen] = useState(false)
  const [dx, setDx] = useState(0)
  const [animating, setAnimating] = useState(true)
  const startX = useRef<number | null>(null)
  const startY = useRef<number | null>(null)
  const axis = useRef<"none" | "h" | "v">("none")
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocPointer(e: PointerEvent) {
      if (
        rootRef.current
        && !rootRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
        setDx(0)
        setAnimating(true)
      }
    }
    document.addEventListener("pointerdown", onDocPointer)
    return () =>
      document.removeEventListener(
        "pointerdown", onDocPointer,
      )
  }, [open])

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    axis.current = "none"
    setAnimating(false)
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startX.current === null || startY.current === null) {
      return
    }
    const deltaX = e.touches[0].clientX - startX.current
    const deltaY = e.touches[0].clientY - startY.current
    if (axis.current === "none") {
      if (Math.abs(deltaX) < AXIS_LOCK
        && Math.abs(deltaY) < AXIS_LOCK) return
      axis.current =
        Math.abs(deltaX) > Math.abs(deltaY) ? "h" : "v"
    }
    if (axis.current !== "h") return
    const base = open ? -actionWidth : 0
    const next = Math.min(
      0, Math.max(-actionWidth, base + deltaX),
    )
    setDx(next)
  }

  function onTouchEnd() {
    const wasHorizontal = axis.current === "h"
    startX.current = null
    startY.current = null
    setAnimating(true)
    if (!wasHorizontal) {
      setDx(open ? -actionWidth : 0)
      return
    }
    if (dx < -OPEN_THRESHOLD) {
      setOpen(true)
      setDx(-actionWidth)
    } else {
      setOpen(false)
      setDx(0)
    }
  }

  function onClickCapture(e: React.MouseEvent) {
    if (open) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      setDx(0)
      setAnimating(true)
    }
  }

  const revealed = open || dx < 0

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        overflow: "hidden",
      }}
    >
      {revealed && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            right: 0,
            width: actionWidth,
            display: "flex",
          }}
        >
          {revealAction}
        </div>
      )}
      <div
        className={className}
        style={{
          position: "relative",
          background: "var(--card)",
          transform: `translateX(${dx}px)`,
          transition: animating
            ? "transform 150ms ease"
            : "none",
        }}
        onClick={open ? undefined : onClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  )
}
