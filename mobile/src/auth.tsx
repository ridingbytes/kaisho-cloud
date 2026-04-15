import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import type { ReactNode } from "react"
import type { SignupResult, User } from "./types"
import {
  clearTokens,
  login as apiLogin,
  setOnAuthExpired,
  setTokens,
  signup as apiSignup,
} from "./api"

type AuthView = "login" | "signup-success" | "recover"

interface AuthCtx {
  user: User | null
  signupResult: SignupResult | null
  authView: AuthView
  setAuthView: (v: AuthView) => void
  login: (email: string, password: string) => Promise<void>
  signup: (
    email: string,
    password: string,
  ) => Promise<void>
  logout: () => void
}

const Ctx = createContext<AuthCtx>(null as never)

export function useAuth() {
  return useContext(Ctx)
}

const STORAGE_KEY = "kaisho_auth"

function loadStored(): User | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

function storeUser(u: User) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
}

export function AuthProvider(
  { children }: { children: ReactNode },
) {
  const [user, setUser] = useState<User | null>(
    loadStored,
  )
  const [signupResult, setSignupResult] =
    useState<SignupResult | null>(null)
  const [authView, setAuthView] =
    useState<AuthView>("login")

  useEffect(() => {
    if (user) {
      setTokens(user.access_token, user.refresh_token)
    }
  }, [user])

  useEffect(() => {
    setOnAuthExpired(() => {
      setUser(null)
      localStorage.removeItem(STORAGE_KEY)
      clearTokens()
    })
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await apiLogin(email, password)
      setTokens(data.access_token, data.refresh_token)
      setUser(data)
      storeUser(data)
    },
    [],
  )

  const signup = useCallback(
    async (email: string, password: string) => {
      const result = await apiSignup(email, password)
      setSignupResult(result)
      setAuthView("signup-success")
    },
    [],
  )

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem(STORAGE_KEY)
    clearTokens()
    setAuthView("login")
  }, [])

  return (
    <Ctx.Provider
      value={{
        user,
        signupResult,
        authView,
        setAuthView,
        login,
        signup,
        logout,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}
