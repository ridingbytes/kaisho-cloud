import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import type { ReactNode } from "react"

export type Theme = "light" | "dark" | "system"

interface ThemeCtx {
  theme: Theme
  setTheme: (t: Theme) => void
  resolved: "light" | "dark"
}

const Ctx = createContext<ThemeCtx>({
  theme: "system",
  setTheme: () => {},
  resolved: "dark",
})

export function useTheme() {
  return useContext(Ctx)
}

const STORAGE_KEY = "kaisho_theme"

function loadStored(): Theme {
  const v = localStorage.getItem(STORAGE_KEY)
  if (v === "light" || v === "dark" || v === "system") {
    return v
  }
  return "system"
}

function systemPreference(): "light" | "dark" {
  if (typeof window === "undefined") return "dark"
  return window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function resolve(theme: Theme): "light" | "dark" {
  return theme === "system" ? systemPreference() : theme
}

function applyTheme(resolved: "light" | "dark") {
  document.documentElement.dataset.theme = resolved
}

export function ThemeProvider(
  { children }: { children: ReactNode },
) {
  const [theme, setThemeState] = useState<Theme>(loadStored)
  const [resolved, setResolved] =
    useState<"light" | "dark">(() => resolve(loadStored()))

  useEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  useEffect(() => {
    if (theme !== "system") {
      setResolved(theme)
      return
    }
    const mq = window.matchMedia(
      "(prefers-color-scheme: dark)",
    )
    const update = () =>
      setResolved(mq.matches ? "dark" : "light")
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    localStorage.setItem(STORAGE_KEY, t)
  }, [])

  return (
    <Ctx.Provider value={{ theme, setTheme, resolved }}>
      {children}
    </Ctx.Provider>
  )
}
