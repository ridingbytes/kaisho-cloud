import i18next from "i18next"
import { initReactI18next } from "react-i18next"
import en from "./locales/en.json"
import de from "./locales/de.json"
import es from "./locales/es.json"

const STORAGE_KEY = "kaisho_lang"

function detectLanguage(): string {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) return stored
  const lang = navigator.language || "en"
  const prefix = lang.slice(0, 2).toLowerCase()
  if (prefix === "de") return "de"
  if (prefix === "es") return "es"
  return "en"
}

i18next
  .use(initReactI18next)
  .init({
    lng: detectLanguage(),
    fallbackLng: "en",
    resources: {
      en: { translation: en },
      de: { translation: de },
      es: { translation: es },
    },
    interpolation: { escapeValue: false },
  })

export function setLanguage(lang: string): void {
  localStorage.setItem(STORAGE_KEY, lang)
  i18next.changeLanguage(lang)
}

export default i18next
