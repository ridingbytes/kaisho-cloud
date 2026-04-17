import type { ReactNode } from "react"
import { useState } from "react"

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
  const [state, setState] =
    useState<ConfirmState | null>(null)

  function confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      setState({ message, resolve })
    })
  }

  function handleResult(value: boolean) {
    state?.resolve(value)
    setState(null)
  }

  const dialog = state ? (
    <div
      className="confirm-backdrop"
      onClick={() => handleResult(false)}
    >
      <div
        className="confirm-dialog"
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
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => handleResult(true)}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  ) : null

  return [confirm, dialog]
}
