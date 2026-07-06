import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"

/**
 * Props for the unified Modal.
 *
 * A single editor surface used across the whole app: a
 * centered dialog on wide screens, a bottom sheet on
 * phones (driven purely by CSS media query — the markup
 * is identical). Replaces the three older ad-hoc patterns
 * (edit-sheet, profile-sheet, detail-panel).
 */
interface Props {
  /** Heading shown in the sticky modal header. */
  title?: string
  /** Optional small line under the title. */
  subtitle?: string
  /** Called on backdrop click, close button, or Escape. */
  onClose: () => void
  /** Body content (scrolls independently of header). */
  children: React.ReactNode
  /** Sticky footer actions (e.g. Cancel / Save). */
  footer?: React.ReactNode
  /**
   * Optional accent colour (project/customer). Tints the
   * header hairline and the grab handle.
   */
  accent?: string
  /**
   * "sheet" (default) hugs the bottom on phones; "center"
   * always floats centered — good for short confirms.
   */
  variant?: "sheet" | "center"
  /** Extra class on the modal card. */
  className?: string
}

/**
 * Modal / bottom-sheet primitive.
 *
 * Handles the platform chrome so callers only supply
 * content: focus capture, Escape-to-close, body-scroll
 * lock, backdrop dismiss, and safe-area padding. Animation
 * and the phone-vs-desktop shape live in App.css.
 */
export function Modal(props: Props) {
  const {
    title, subtitle, onClose, children, footer,
    accent, variant = "sheet", className = "",
  } = props
  const cardRef = useRef<HTMLDivElement>(null)

  // Escape to dismiss + lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  // Move focus into the card so the keyboard/AT lands
  // inside the dialog, not on the page behind it.
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const focusable = card.querySelector<HTMLElement>(
      "input, textarea, select, button, [tabindex]",
    )
    focusable?.focus()
  }, [])

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={onClose}
    >
      <div
        ref={cardRef}
        className={
          `modal-card modal-${variant} ${className}`
        }
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-grip" aria-hidden="true">
          <span
            style={
              accent ? { background: accent } : undefined
            }
          />
        </div>
        {(title || footer !== undefined) && (
          <header
            className="modal-header"
            style={
              accent
                ? { borderBottomColor: accent + "55" }
                : undefined
            }
          >
            <div className="modal-heading">
              {title && <h3>{title}</h3>}
              {subtitle && (
                <p className="modal-subtitle">
                  {subtitle}
                </p>
              )}
            </div>
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              aria-label="Close"
            >
              <svg
                width="18" height="18" viewBox="0 0 20 20"
                fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round"
              >
                <line x1="5" y1="5" x2="15" y2="15" />
                <line x1="15" y1="5" x2="5" y2="15" />
              </svg>
            </button>
          </header>
        )}
        <div className="modal-body">{children}</div>
        {footer && (
          <footer className="modal-footer">{footer}</footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
