import { useAuth } from "./auth"
import { LoginForm } from "./components/LoginForm"
import { SignupSuccess } from "./components/SignupSuccess"
import { RecoverKey } from "./components/RecoverKey"
import { AppShell } from "./components/AppShell"

export function App() {
  const { user, authView } = useAuth()

  if (user) return <AppShell />

  switch (authView) {
    case "signup-success":
      return <SignupSuccess />
    case "recover":
      return <RecoverKey />
    default:
      return <LoginForm />
  }
}
