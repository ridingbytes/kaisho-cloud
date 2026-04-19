import { useEffect, useState } from "react"
import { useAuth } from "./auth"
import { LoginForm } from "./components/LoginForm"
import { SignupSuccess } from "./components/SignupSuccess"
import { ForgotPassword } from "./components/ForgotPassword"
import { ResetPassword } from "./components/ResetPassword"
import { AppShell } from "./components/AppShell"

function extractResetToken(): string | null {
  const hash = window.location.hash
  const match = hash.match(
    /access_token=([^&]+)/,
  )
  return match ? match[1] : null
}

export function App() {
  const { user, authView, setAuthView } = useAuth()
  const [resetToken, setResetToken] = useState<
    string | null
  >(null)

  useEffect(() => {
    const token = extractResetToken()
    if (token) {
      setResetToken(token)
      setAuthView("reset-password")
      // Clean the URL
      window.history.replaceState(
        {}, "", window.location.pathname,
      )
    }
  }, [setAuthView])

  if (user) return <AppShell />

  switch (authView) {
    case "signup-success":
      return <SignupSuccess />
    case "forgot-password":
      return <ForgotPassword />
    case "reset-password":
      return (
        <ResetPassword
          accessToken={resetToken || ""}
        />
      )
    default:
      return <LoginForm />
  }
}
