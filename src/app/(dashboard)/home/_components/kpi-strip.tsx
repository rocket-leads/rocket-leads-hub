import { cn } from "@/lib/utils"
import { ArrowDown, ArrowUp, Minus } from "lucide-react"

type Status = "good" | "bad" | "neutral"

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
  const valueColor =
    status === "good" ? "text-green-500" : status === "bad" ? "text-red-500" : "text-foreground"
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

function fmtMrr(v: number): string {
  if (v >= 1000) return `€${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
  return `€${v.toFixed(0)}`
}

export function KpiStrip({
  actionCount,
  actionDelta,
  unreadInboxCount,
  healthScore,
  teamMrr,
  teamMrrClientCount,
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
}) {
  // Action — bad whenever > 0. Trend up = more action than yesterday (red);
  // trend down = fewer (green).
  const actionStatus: Status = actionCount === 0 ? "neutral" : "bad"
  const actionTrend: "up" | "down" | "flat" =
    actionDelta > 0 ? "up" : actionDelta < 0 ? "down" : "flat"
  const actionDeltaText =
    actionDelta === 0 ? "= yesterday" : actionDelta > 0 ? `+${actionDelta} vs yesterday` : `${actionDelta} vs yesterday`

  const inboxStatus: Status = unreadInboxCount > 0 ? "bad" : "neutral"

  // Health zones mirror the Watch List header: <50 bad, 50-74 neutral, ≥75 good.
  const healthStatus: Status =
    healthScore == null
      ? "neutral"
      : healthScore < 50
        ? "bad"
        : healthScore < 75
          ? "neutral"
          : "good"

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Card
        label="Action needed"
        value={`${actionCount}`}
        subtitle={actionDeltaText}
        status={actionStatus}
        trend={actionTrend}
      />
      <Card
        label="Inbox voor jou"
        value={`${unreadInboxCount}`}
        subtitle={unreadInboxCount === 0 ? "Inbox zero" : "tasks + unread updates"}
        status={inboxStatus}
      />
      <Card
        label="Health score"
        value={healthScore == null ? "—" : `${healthScore}%`}
        subtitle={healthScore == null ? "No live clients in scope" : "target ≥ 75%"}
        status={healthStatus}
      />
      <Card
        label="Team MRR"
        value={fmtMrr(teamMrr)}
        subtitle={
          teamMrrClientCount === 0
            ? "Geen actieve agreements"
            : `${teamMrrClientCount} ${teamMrrClientCount === 1 ? "client" : "clients"} live`
        }
        status="neutral"
      />
    </div>
  )
}
