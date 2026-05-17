import { useTranslation } from "react-i18next"

interface Props {
  message?: string
}

/**
 * Inline banner shown when a feature requires a paid plan.
 *
 * 2.0 pivot: the old sync / sync_ai SKUs are archived. The
 * new Companion / Pro / Team tiers launch in Q3 2026, so
 * this banner currently only informs and links out — no
 * Stripe checkout. The full upgrade flow returns when
 * Companion ships.
 */
export function UpgradeBanner({ message }: Props) {
  const { t } = useTranslation()
  const displayMessage =
    message ?? t("upgrade_banner.default_message")

  return (
    <div className="upgrade-banner">
      <p className="upgrade-msg">{displayMessage}</p>
      <p className="upgrade-coming-soon">
        <strong>{t("upgrade.coming_soon")}</strong>
        {" — "}
        {t("upgrade.coming_soon_detail")}{" "}
        <a
          href="https://kaisho.dev/#pricing"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("upgrade.coming_soon_link")}
        </a>
      </p>
    </div>
  )
}
