import { KpiTile, type KpiValueTone } from "@/components/ui/kpi-tile"
import { t } from "@/lib/i18n/t"
import { formatCurrency } from "@/lib/i18n/format"
import type { Locale } from "@/lib/i18n/types"

function fmtMrrCompact(v: number, locale: Locale): string {
  // Compact card-friendly form ("€61k" / "€2.5k") - falls back to the
  // full Intl-formatted amount for sub-1000 totals so we don't show
  // confusing "€600" rounded values.
  if (v >= 1000) return `€${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
  return formatCurrency(v, locale)
}

export function KpiStrip({
  actionCount,
  actionDelta,
  unreadInboxCount,
  healthScore,
  teamMrr,
  teamMrrClientCount,
  locale,
}: {
  actionCount: number
  /** Today minus yesterday - positive means more action clients today (bad). */
  actionDelta: number
  unreadInboxCount: number
  /** 0–100, or null when there are no live clients in scope. */
  healthScore: number | null
  /** Sum of agreement-monthly across visible clients. */
  teamMrr: number
  /** Number of visible clients with a non-zero agreement MRR. */
  teamMrrClientCount: number
  locale: Locale
}) {
  // Action - bad whenever > 0. Trend up = more action than yesterday (red);
  // trend down = fewer (green). goodWhen="down" so positive delta = red.
  const actionTone: KpiValueTone = actionCount === 0 ? "neutral" : "bad"

  // Inbox zero is a win - green when achieved, red when stuff on the plate.
  const inboxTone: KpiValueTone = unreadInboxCount > 0 ? "bad" : "good"

  // Health zones - full traffic light: <50 red, 50-74 amber, ≥75 green.
  const healthTone: KpiValueTone =
    healthScore == null
      ? "neutral"
      : healthScore < 50
        ? "bad"
        : healthScore < 75
          ? "warn"
          : "good"

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiTile
        label={t("home.kpi.action.label", locale)}
        value={`${actionCount}`}
        valueTone={actionTone}
        trend={
          actionDelta === 0
            ? undefined
            : {
                pct: actionDelta,
                label:
                  actionDelta > 0
                    ? t("home.kpi.action.delta_pos", locale, { n: actionDelta })
                    : t("home.kpi.action.delta_neg", locale, { n: actionDelta }),
                goodWhen: "down",
              }
        }
        sub={
          actionDelta === 0
            ? t("home.kpi.action.eq_yesterday", locale)
            : undefined
        }
      />
      <KpiTile
        label={t("home.kpi.inbox.label", locale)}
        value={`${unreadInboxCount}`}
        valueTone={inboxTone}
        sub={
          unreadInboxCount === 0
            ? t("home.kpi.inbox.zero", locale)
            : t("home.kpi.inbox.subtitle", locale)
        }
      />
      <KpiTile
        label={t("home.kpi.health.label", locale)}
        value={healthScore == null ? "-" : `${healthScore}%`}
        valueTone={healthTone}
        sub={
          healthScore == null
            ? t("home.kpi.health.no_scope", locale)
            : t("home.kpi.health.target", locale)
        }
      />
      <KpiTile
        label={t("home.kpi.mrr.label", locale)}
        value={fmtMrrCompact(teamMrr, locale)}
        sub={
          teamMrrClientCount === 0
            ? t("home.kpi.mrr.no_agreements", locale)
            : t(
                teamMrrClientCount === 1 ? "home.kpi.mrr.live_one" : "home.kpi.mrr.live_many",
                locale,
                { n: teamMrrClientCount },
              )
        }
      />
    </div>
  )
}
