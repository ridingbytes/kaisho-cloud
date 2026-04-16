import {
  createContext,
  useCallback,
  useContext,
  useState,
} from "react"
import type { ReactNode } from "react"

interface Toast {
  id: number
  message: string
  type: "success" | "error"
}

interface ToastCtx {
  toast: (msg: string, type?: "success" | "error") => void
}

const Ctx = createContext<ToastCtx>({
  toast: () => {},
})

export function useToast() {
  return useContext(Ctx)
}

let nextId = 0

export function ToastProvider(
  { children }: { children: ReactNode },
) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback(
    (msg: string, type: "success" | "error" = "success") => {
      const id = ++nextId
      setToasts((t) => [...t, { id, message: msg, type }])
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id))
      }, 3000)
    },
    [],
  )

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.type}`}
            role="status"
            aria-live="polite"
          >
            <span className="toast-icon" aria-hidden="true">
              {t.type === "success" ? "✓" : "!"}
            </span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
