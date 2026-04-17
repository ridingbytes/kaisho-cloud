import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import type { ReactNode } from "react"
import type { SignupResult, User } from "./types"
import {
  clearTokens,
  getMe,
  login as apiLogin,
  setOnAuthExpired,
  setOnTokensRefreshed,
  setTokens,
  signup as apiSignup,
} from "./api"
import {
  connectWs,
  disconnectWs,
  updateWsToken,
} from "./ws"

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

// Hydrate tokens synchronously at module load so the first
// render can make authenticated API calls (setTokens in a
// useEffect would run after components mount and fire 401s).
const initialUser = loadStored()
if (initialUser) {
  setTokens(
    initialUser.access_token, initialUser.refresh_token,
  )
}

export function AuthProvider(
  { children }: { children: ReactNode },
) {
  const [user, setUser] = useState<User | null>(initialUser)
  const [signupResult, setSignupResult] =
    useState<SignupResult | null>(null)
  const [authView, setAuthView] =
    useState<AuthView>("login")

  // Refresh plan info from server on mount (plan may have
  // changed server-side since last login).
  useEffect(() => {
    if (!user) return
    getMe()
      .then((me) => {
        if (me.plan !== user.plan || me.email !== user.email) {
          const next = {
            ...user,
            plan: me.plan,
            email: me.email,
          }
          setUser(next)
          storeUser(next)
        }
      })
      .catch(() => {
        // ignore; will retry next mount
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Connect WebSocket on initial login only.
  // Token refreshes are handled by updateWsToken()
  // in setOnTokensRefreshed above.
  const wsInitialized = useRef(false)
  useEffect(() => {
    if (user?.access_token && !wsInitialized.current) {
      wsInitialized.current = true
      connectWs(user.access_token)
    }
  }, [user?.access_token])

  useEffect(() => {
    setOnAuthExpired(() => {
      disconnectWs()
      setUser(null)
      localStorage.removeItem(STORAGE_KEY)
      clearTokens()
    })
    setOnTokensRefreshed((access, refresh) => {
      updateWsToken(access)
      setUser((prev) => {
        if (!prev) return prev
        const next = {
          ...prev,
          access_token: access,
          refresh_token: refresh,
        }
        storeUser(next)
        return next
      })
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
    disconnectWs()
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
