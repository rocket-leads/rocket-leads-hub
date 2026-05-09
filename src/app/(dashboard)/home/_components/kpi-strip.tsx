import { cn } from "@/lib/utils"
import { ArrowDown, ArrowUp, Minus } from "lucide-react"
import { t } from "@/lib/i18n/t"
import { formatCurrency } from "@/lib/i18n/format"
import type { Locale } from "@/lib/i18n/types"

type Status = "good" | "warn" | "bad" | "neutral"

function Card({
  label,
  value,
  subtitle,
  status,
  trend,
}: {
  label: string
  value: string
  subtitle: string
  status: Status
  trend?: "up" | "down" | "flat"
}) {
  // Traffic-light: bad red, warn amber, good green. Neutral keeps the default
  // text color so cards without a verdict don't fight for attention.
  const valueColor =
    status === "good"
      ? "text-green-500"
      : status === "warn"
        ? "text-amber-400"
        : status === "bad"
          ? "text-red-500"
          : "text-foreground"
  const TrendIcon = trend === "up" ? ArrowUp : trend === "down" ? ArrowDown : Minus
  const trendColor =
    trend === "up"
      ? "text-red-500"
      : trend === "down"
        ? "text-green-500"
        : "text-muted-foreground/40"
  return (
    <div className="bg-card rounded-lg p-5 border border-border/40 flex flex-col gap-2 h-full">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</span>
        {trend && <TrendIcon className={cn("h-3.5 w-3.5", trendColor)} strokeWidth={2.5} />}
      </div>
      <span className={cn("text-3xl font-bold font-mono leading-none tracking-tight", valueColor)}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground leading-relaxed">{subtitle}</span>
    </div>
  )
}

function fmtMrrCompact(v: number, locale: Locale): string {
  // Compact card-friendly form ("€61k" / "€2.5k") — falls back to the
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
  /** Today minus yesterday — positive means more action clients today (bad). */
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
  // Action — bad whenever > 0. Trend up = more action than yesterday (red);
  // trend down = fewer (green).
  const actionStatus: Status = actionCount === 0 ? "neutral" : "bad"
  const actionTrend: "up" | "down" | "flat" =
    actionDelta > 0 ? "up" : actionDelta < 0 ? "down" : "flat"
  const actionDeltaText =
    actionDelta === 0
      ? t("home.kpi.action.eq_yesterday", locale)
      : actionDelta > 0
        ? t("home.kpi.action.delta_pos", locale, { n: actionDelta })
        : t("home.kpi.action.delta_neg", locale, { n: actionDelta })

  // Inbox zero is a win — colour it green when achieved, red when there's
  // still stuff on the user's plate.
  const inboxStatus: Status = unreadInboxCount > 0 ? "bad" : "good"

  // Health zones — full traffic light: <50 red, 50-74 amber, ≥75 green.
  const healthStatus: Status =
    healthScore == null
      ? "neutral"
      : healthScore < 50
        ? "bad"
        : healthScore < 75
          ? "warn"
          : "good"

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Card
        label={t("home.kpi.action.label", locale)}
        value={`${actionCount}`}
        subtitle={actionDeltaText}
        status={actionStatus}
        trend={actionTrend}
      />
      <Card
        label={t("home.kpi.inbox.label", locale)}
        value={`${unreadInboxCount}`}
        subtitle={
          unreadInboxCount === 0
            ? t("home.kpi.inbox.zero", locale)
            : t("home.kpi.inbox.subtitle", locale)
        }
        status={inboxStatus}
      />
      <Card
        label={t("home.kpi.health.label", locale)}
        value={healthScore == null ? "—" : `${healthScore}%`}
        subtitle={
          healthScore == null
            ? t("home.kpi.health.no_scope", locale)
            : t("home.kpi.health.target", locale)
        }
        status={healthStatus}
      />
      <Card
        label={t("home.kpi.mrr.label", locale)}
        value={fmtMrrCompact(teamMrr, locale)}
        subtitle={
          teamMrrClientCount === 0
            ? t("home.kpi.mrr.no_agreements", locale)
            : t(
                teamMrrClientCount === 1 ? "home.kpi.mrr.live_one" : "home.kpi.mrr.live_many",
                locale,
                { n: teamMrrClientCount },
              )
        }
        status="neutral"
      />
    </div>
  )
}
