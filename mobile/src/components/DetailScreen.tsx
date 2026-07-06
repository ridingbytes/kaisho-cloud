import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"

interface Props {
  /** Title shown centered in the nav bar. */
  title: string
  /** Called after the pop animation finishes. */
  onBack: () => void
  /** Label next to the back chevron (e.g. "Tasks"). */
  backLabel?: string
  /** Right-hand nav action (Edit / Save button). */
  action?: React.ReactNode
  /**
   * Overrides the default back chevron (e.g. a "Cancel"
   * button in edit mode that reverts instead of popping).
   */
  leftAction?: React.ReactNode
  /** Optional accent (project colour) for the title bar. */
  accent?: string
  children: React.ReactNode
}

/**
 * Fullscreen, stacked detail screen with iOS-style push
 * navigation: slides in from the right on mount, slides
 * back out to the right on dismiss. Provides the nav bar
 * (back chevron, title, one right action) and a scrolling
 * body; callers own the view/edit content.
 *
 * Replaces the bottom-sheet Modal for item detail/editing
 * so drilling into a task, note, entry or project feels
 * like navigating, not summoning an overlay.
 */
export function DetailScreen(props: Props) {
  const {
    title, onBack, backLabel, action, leftAction,
    accent, children,
  } = props
  const { t } = useTranslation()
  const [closing, setClosing] = useState(false)

  // Pop: play the slide-out, then unmount via onBack.
  function dismiss() {
    if (closing) return
    setClosing(true)
    window.setTimeout(onBack, 240)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss()
    }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return createPortal(
    <div
      className={
        "detail-screen" +
        (closing ? " detail-screen--closing" : "")
      }
      role="dialog"
      aria-modal="true"
    >
      <header
        className="ds-nav"
        style={
          accent
            ? { borderBottomColor: accent + "44" }
            : undefined
        }
      >
        {leftAction ? (
          <div className="ds-left">{leftAction}</div>
        ) : (
          <button
            type="button"
            className="ds-back"
            onClick={dismiss}
          >
            <svg
              width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 5 8 12 15 19" />
            </svg>
            <span>{backLabel || t("edit.cancel")}</span>
          </button>
        )}
        <h2 className="ds-title">{title}</h2>
        <div className="ds-action">{action}</div>
      </header>
      <div className="ds-body">{children}</div>
    </div>,
    document.body,
  )
}
