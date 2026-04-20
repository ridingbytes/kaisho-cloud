import type { KeyboardEvent, ReactNode } from "react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

/**
 * Inline confirmation dialog that replaces browser
 * confirm(). Renders as a centered modal over a
 * backdrop, matching the app's dark/light theme.
 *
 * Usage:
 *   const [confirm, dialog] = useConfirm()
 *   const ok = await confirm("Delete this entry?")
 *   if (ok) { ... }
 *   // render {dialog} in the JSX
 */

interface ConfirmState {
  message: string
  resolve: (value: boolean) => void
}

/**
 * Hook that returns a ``confirm`` function and a
 * dialog element to render.
 *
 * The confirm function returns a Promise<boolean>
 * that resolves when the user taps Confirm or Cancel.
 */
export function useConfirm(): [
  (message: string) => Promise<boolean>,
  ReactNode,
] {
  const { t } = useTranslation()
  const [state, setState] =
    useState<ConfirmState | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  function confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      setState({ message, resolve })
    })
  }

  function handleResult(value: boolean) {
    state?.resolve(value)
    setState(null)
  }

  function trapFocus(e: KeyboardEvent) {
    if (e.key !== "Tab" || !dialogRef.current) return
    const focusable =
      dialogRef.current.querySelectorAll<HTMLElement>(
        "button, [href], input, select, " +
        "textarea, [tabindex]:not([tabindex=\"-1\"])",
      )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (
      !e.shiftKey && document.activeElement === last
    ) {
      e.preventDefault()
      first.focus()
    }
  }

  const dialog = state ? (
    <div
      className="confirm-backdrop"
      onClick={() => handleResult(false)}
    >
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        onKeyDown={trapFocus}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="confirm-message">
          {state.message}
        </p>
        <div className="confirm-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => handleResult(false)}
          >
            {t("confirm.cancel")}
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => handleResult(true)}
          >
            {t("confirm.confirm")}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return [confirm, dialog]
}
