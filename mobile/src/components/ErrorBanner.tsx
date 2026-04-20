import { useTranslation } from "react-i18next"

interface Props {
  message: string | null
  onDismiss?: () => void
}

export function ErrorBanner({ message, onDismiss }: Props) {
  const { t } = useTranslation()
  if (!message) return null
  return (
    <div className="error-banner">
      <span>{message}</span>
      {onDismiss && (
        <button
          className="error-dismiss"
          onClick={onDismiss}
          aria-label={t("error_banner.dismiss")}
        >
          x
        </button>
      )}
    </div>
  )
}
