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

export function KpiStrip({
  actionCount,
  actionDelta,
  watchCount,
  goodCount,
  unreadInboxCount,
  overdueAmount,
  overdueCount,
  pedroCount,
  showPedro,
}: {
  actionCount: number
  /** Today minus yesterday — positive means more action clients today (bad). */
  actionDelta: number
  watchCount: number
  goodCount: number
  unreadInboxCount: number
  overdueAmount: number
  overdueCount: number
  pedroCount: number
  showPedro: boolean
}) {
  const totalLive = actionCount + watchCount + goodCount

  // Action card — the most important number on the page. Color = bad when >0,
  // neutral at zero. Trend up = more action than yesterday (red); down = less.
  const actionStatus: Status = actionCount === 0 ? "neutral" : "bad"
  const actionTrend: "up" | "down" | "flat" =
    actionDelta > 0 ? "up" : actionDelta < 0 ? "down" : "flat"
  const actionDeltaText =
    actionDelta === 0 ? "= yesterday" : actionDelta > 0 ? `+${actionDelta} vs yesterday` : `${actionDelta} vs yesterday`

  const inboxStatus: Status = unreadInboxCount > 0 ? "bad" : "neutral"

  const overdueStatus: Status = overdueAmount > 0 ? "bad" : "neutral"
  const overdueValue = overdueAmount > 0
    ? `€${(overdueAmount / 1000).toFixed(overdueAmount >= 10000 ? 0 : 1)}k`
    : "€0"

  const pedroStatus: Status = pedroCount > 0 ? "bad" : "neutral"

  const cols = showPedro ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-3"

  return (
    <div className={cn("grid gap-3", cols)}>
      <Card
        label="Action needed"
        value={`${actionCount}`}
        subtitle={totalLive === 0 ? "No live clients in scope" : actionDeltaText}
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
        label="Open invoices"
        value={overdueValue}
        subtitle={
          overdueCount === 0
            ? "All paid"
            : `${overdueCount} ${overdueCount === 1 ? "client" : "clients"}`
        }
        status={overdueStatus}
      />
      {showPedro && (
        <Card
          label="Pedro proposals"
          value={`${pedroCount}`}
          subtitle={pedroCount === 0 ? "Niks te reviewen" : "knowledge ideas pending"}
          status={pedroStatus}
        />
      )}
    </div>
  )
}
