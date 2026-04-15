import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { AuthProvider } from "./auth"
import { ToastProvider } from "./toast"
import { App } from "./App"
import "./App.css"

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/m/sw.js")
    .catch(() => {})
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
)
