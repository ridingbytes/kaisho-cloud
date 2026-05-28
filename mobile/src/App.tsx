import { useEffect, useState } from "react"
import { useAuth } from "./auth"
import { createCheckout } from "./api"
import {
  captureUpgradeFromUrl,
  takePendingUpgrade,
} from "./utils/pendingUpgrade"
import { LoginForm } from "./components/LoginForm"
import { SignupSuccess } from "./components/SignupSuccess"
import { ForgotPassword } from "./components/ForgotPassword"
import { ResetPassword } from "./components/ResetPassword"
import { AppShell } from "./components/AppShell"

function extractResetToken(): string | null {
  const hash = window.location.hash
  const match = hash.match(
    /reset-password=([^&]+)/,
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

  // Capture ?upgrade=<plan> from a marketing-site CTA on
  // first mount and strip it from the URL so reloads do
  // not re-fire. The plan is consumed below once the user
  // is authenticated.
  useEffect(() => {
    captureUpgradeFromUrl()
  }, [])

  // Resume a captured upgrade intent the moment the user
  // becomes authenticated. takePendingUpgrade clears the
  // entry on read so a cancelled checkout does not loop.
  useEffect(() => {
    if (!user) return
    const plan = takePendingUpgrade()
    if (!plan) return
    createCheckout(plan)
      .then((res) => {
        if (res.url) window.location.href = res.url
      })
      .catch(() => {
        // Surface nothing here; the user can retry from
        // the Profile screen. We deliberately do not
        // re-stash the intent so a server-side error does
        // not pin the user in a redirect loop.
      })
  }, [user])

  if (user) return <AppShell />

  switch (authView) {
    case "signup-success":
      return <SignupSuccess />
    case "forgot-password":
      return <ForgotPassword />
    case "reset-password":
      return (
        <ResetPassword
          token={resetToken || ""}
        />
      )
    default:
      return <LoginForm />
  }
}
