import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, CheckCircle2, AlertCircle, AlertTriangle, Clock } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Hub observability surface — shows every cron's last run + every integration
 * token's validity. Wave 1 of the foundation work: now we can see what's
 * broken, instead of finding out via a screenshot from a CM.
 *
 * Reads:
 *   - cron_runs (latest row per cron_name)
 *   - api_tokens (per-service is_valid + last_verified)
 *
 * Admin-only — same gate as the rest of /settings/*.
 */

type CronRow = {
  cron_name: string
  status: "ok" | "error" | "partial"
  started_at: string
  finished_at: string
  duration_ms: number
  error_message: string | null
  metrics: Record<string, unknown>
}

/** Crons we expect to see — used to surface "never run" gaps for crons that
 *  are wired into Vercel but haven't ticked yet. Keep this in sync with
 *  /api/cron/* directories. */
const EXPECTED_CRONS: ReadonlyArray<{ name: string; description: string; cadence: string }> = [
  { name: "refresh-kpi", description: "KPI summaries + daily rollup cache", cadence: "daily 5:00 UTC" },
  { name: "refresh-cache", description: "Watch List context, billing, AI proposals overview", cadence: "daily 5:30 UTC" },
  { name: "refresh-billing-summaries", description: "Stripe billing summaries + past invoices", cadence: "hourly" },
  { name: "refresh-invoice-readiness", description: "AI invoice readiness verdicts", cadence: "every 6h" },
  { name: "refresh-proposals", description: "Per-client AI optimisation proposals", cadence: "daily" },
  { name: "refresh-watchlist-context", description: "Monday updates + Trengo summaries for watchlist AI", cadence: "daily" },
  { name: "refresh-pedro-patterns", description: "Pedro vertical-pattern synthesis", cadence: "nightly" },
  { name: "pedro-knowledge-proposals", description: "Pedro knowledge-base scan", cadence: "weekly" },
  { name: "sync-campaign-status", description: "Live ↔ On Hold flip + onboarding → LAUNCH", cadence: "daily" },
  { name: "inbox-automations", description: "Inbox snooze / auto-resolve rules", cadence: "hourly" },
  { name: "slack-team-watchlist", description: "Team watchlist Slack post", cadence: "hourly (gated)" },
  { name: "slack-daily-watchlist", description: "Personal watchlist Slack DMs", cadence: "hourly (gated)" },
  { name: "slack-team-sales", description: "Team sales Slack post", cadence: "hourly (gated)" },
  { name: "slack-personal-sales", description: "Personal sales Slack DMs", cadence: "hourly (gated)" },
] as const

const SERVICES_EXPECTED = ["monday", "meta", "stripe", "trengo", "slack", "fathom", "anthropic"] as const

export default async function HealthPage() {
  const session = await auth()
  if (!session || session.user.role !== "admin") redirect("/home")

  const supabase = await createAdminClient()

  // Snapshot timestamps once at the top of render so every comparison below
  // uses the same instant, keeping the "errors in last 24h" boundary and the
  // "last run X ago" math consistent. Server components only render once per
  // request, so the impurity-during-render lint isn't a real concern here.
  // eslint-disable-next-line react-hooks/purity
  const renderNow = Date.now()
  const last24hCutoff = new Date(renderNow - 24 * 60 * 60 * 1000).toISOString()

  // Pull latest run per cron in one round-trip. Limit 200 rows is plenty —
  // we only need the most recent per cron_name, and there are <20 crons.
  const [{ data: cronRows }, { data: tokenRows }, { data: errorRows }] = await Promise.all([
    supabase
      .from("cron_runs")
      .select("cron_name, status, started_at, finished_at, duration_ms, error_message, metrics")
      .order("started_at", { ascending: false })
      .limit(200),
    supabase
      .from("api_tokens")
      .select("service, is_valid, last_verified"),
    // Last 24h of errored runs — feeds the "what's currently broken" banner.
    supabase
      .from("cron_runs")
      .select("cron_name, status, started_at, error_message")
      .neq("status", "ok")
      .gte("started_at", last24hCutoff)
      .order("started_at", { ascending: false })
      .limit(50),
  ])

  // Latest row per cron_name. Iteration order is desc-by-started_at, so the
  // first hit per name is the latest.
  const latestByCron = new Map<string, CronRow>()
  for (const row of (cronRows ?? []) as CronRow[]) {
    if (!latestByCron.has(row.cron_name)) latestByCron.set(row.cron_name, row)
  }

  const tokenStatuses = Object.fromEntries(
    (tokenRows ?? []).map((t) => [t.service, { is_valid: t.is_valid, last_verified: t.last_verified }]),
  )

  const totalCrons = EXPECTED_CRONS.length
  const okCrons = EXPECTED_CRONS.filter((c) => latestByCron.get(c.name)?.status === "ok").length
  const errorCrons = EXPECTED_CRONS.filter((c) => latestByCron.get(c.name)?.status === "error").length
  const partialCrons = EXPECTED_CRONS.filter((c) => latestByCron.get(c.name)?.status === "partial").length
  const neverRanCrons = EXPECTED_CRONS.filter((c) => !latestByCron.has(c.name)).length

  const validIntegrations = SERVICES_EXPECTED.filter((s) => tokenStatuses[s]?.is_valid).length
  const totalIntegrations = SERVICES_EXPECTED.length

  return (
    <div>
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Settings
      </Link>

      <div className="mb-6">
        <h1 className="text-[22px] font-heading font-semibold tracking-tight leading-tight">Health</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          Cron + integration heartbeat. Surface for &ldquo;is the data we&apos;re showing actually fresh?&rdquo;
        </p>
      </div>

      {/* Top-line summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SummaryCard
          label="Crons OK"
          value={`${okCrons}/${totalCrons}`}
          status={okCrons === totalCrons ? "good" : okCrons >= totalCrons * 0.75 ? "warn" : "bad"}
          subtitle={
            errorCrons === 0 && partialCrons === 0 && neverRanCrons === 0
              ? "All clear"
              : [
                  errorCrons > 0 ? `${errorCrons} errored` : null,
                  partialCrons > 0 ? `${partialCrons} partial` : null,
                  neverRanCrons > 0 ? `${neverRanCrons} never ran` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
          }
        />
        <SummaryCard
          label="Integrations valid"
          value={`${validIntegrations}/${totalIntegrations}`}
          status={validIntegrations === totalIntegrations ? "good" : validIntegrations >= 5 ? "warn" : "bad"}
          subtitle={
            validIntegrations === totalIntegrations
              ? "All tokens valid"
              : `${totalIntegrations - validIntegrations} need attention`
          }
        />
        <SummaryCard
          label="Errors (24h)"
          value={`${errorRows?.length ?? 0}`}
          status={(errorRows?.length ?? 0) === 0 ? "good" : "bad"}
          subtitle={(errorRows?.length ?? 0) === 0 ? "Clean run" : "Cron failures in last 24h"}
        />
        <SummaryCard
          label="Last refresh-kpi"
          value={formatRelativeFrom(latestByCron.get("refresh-kpi")?.started_at, renderNow)}
          status={(() => {
            const last = latestByCron.get("refresh-kpi")
            if (!last) return "bad"
            if (last.status !== "ok") return "bad"
            const ageH = (renderNow - new Date(last.started_at).getTime()) / 3600000
            return ageH > 30 ? "warn" : "good"
          })()}
          subtitle="Drives Watch List numbers"
        />
      </div>

      {/* Crons table */}
      <section className="mb-8">
        <h2 className="text-sm font-medium mb-3">Crons</h2>
        <div className="rounded-lg border border-border/40 overflow-hidden">
          <div className="grid grid-cols-[1.5fr_1.5fr_100px_120px_100px_2fr] gap-x-4 px-4 py-2.5 border-b border-border/40 bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground/70">
            <span>Cron</span>
            <span>Description</span>
            <span>Status</span>
            <span>Last run</span>
            <span>Duration</span>
            <span>Notes</span>
          </div>
          {EXPECTED_CRONS.map((c) => {
            const row = latestByCron.get(c.name)
            const status = row?.status ?? "never_ran"
            return (
              <div
                key={c.name}
                className="grid grid-cols-[1.5fr_1.5fr_100px_120px_100px_2fr] gap-x-4 px-4 py-2.5 border-b border-border/30 last:border-b-0 items-center text-xs"
              >
                <div>
                  <div className="font-mono text-[12px]">{c.name}</div>
                  <div className="text-[10px] text-muted-foreground/50">{c.cadence}</div>
                </div>
                <span className="text-muted-foreground leading-snug">{c.description}</span>
                <CronStatusPill status={status} />
                <span className="text-muted-foreground tabular-nums">
                  {row ? formatRelativeFrom(row.started_at, renderNow) : "—"}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {row ? formatDuration(row.duration_ms) : "—"}
                </span>
                <span className="text-muted-foreground/70 truncate" title={row?.error_message ?? ""}>
                  {row?.error_message ??
                    (row?.metrics ? formatMetrics(row.metrics) : "—")}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {/* Integrations */}
      <section className="mb-8">
        <h2 className="text-sm font-medium mb-3">Integrations</h2>
        <div className="rounded-lg border border-border/40 overflow-hidden">
          <div className="grid grid-cols-[1fr_120px_2fr] gap-x-4 px-4 py-2.5 border-b border-border/40 bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground/70">
            <span>Service</span>
            <span>Status</span>
            <span>Last verified</span>
          </div>
          {SERVICES_EXPECTED.map((service) => {
            const t = tokenStatuses[service]
            return (
              <div
                key={service}
                className="grid grid-cols-[1fr_120px_2fr] gap-x-4 px-4 py-2.5 border-b border-border/30 last:border-b-0 items-center text-xs"
              >
                <span className="font-medium capitalize">{service}</span>
                <IntegrationStatusPill valid={t?.is_valid ?? null} />
                <span className="text-muted-foreground tabular-nums">
                  {t?.last_verified ? formatRelativeFrom(t.last_verified, renderNow) : "Never"}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {/* Recent errors */}
      {(errorRows?.length ?? 0) > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-medium mb-3">Recent errors (24h)</h2>
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 overflow-hidden">
            {(errorRows ?? []).map((row, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_140px_3fr] gap-x-4 px-4 py-2 border-b border-red-500/10 last:border-b-0 items-center text-xs"
              >
                <span className="font-mono text-[11px]">{row.cron_name}</span>
                <span className="text-muted-foreground tabular-nums">{formatRelativeFrom(row.started_at, renderNow)}</span>
                <span className="text-red-400 truncate" title={row.error_message ?? ""}>
                  {row.error_message ?? "(no message)"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────

type CardStatus = "good" | "warn" | "bad" | "neutral"

function SummaryCard({
  label,
  value,
  subtitle,
  status,
}: {
  label: string
  value: string
  subtitle: string
  status: CardStatus
}) {
  const valueColor =
    status === "good"
      ? "text-green-500"
      : status === "warn"
        ? "text-amber-400"
        : status === "bad"
          ? "text-red-500"
          : "text-foreground"
  return (
    <div className="bg-card rounded-lg p-5 border border-border/40 flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</span>
      <span className={cn("text-3xl font-bold font-mono leading-none tracking-tight", valueColor)}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground leading-relaxed">{subtitle}</span>
    </div>
  )
}

function CronStatusPill({ status }: { status: "ok" | "error" | "partial" | "never_ran" }) {
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1.5 text-green-500 text-[11px] font-medium">
        <CheckCircle2 className="h-3 w-3" /> OK
      </span>
    )
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-red-500 text-[11px] font-medium">
        <AlertCircle className="h-3 w-3" /> Error
      </span>
    )
  }
  if (status === "partial") {
    return (
      <span className="inline-flex items-center gap-1.5 text-amber-400 text-[11px] font-medium">
        <AlertTriangle className="h-3 w-3" /> Partial
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground/50 text-[11px] font-medium">
      <Clock className="h-3 w-3" /> Never ran
    </span>
  )
}

function IntegrationStatusPill({ valid }: { valid: boolean | null }) {
  if (valid === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground/50 text-[11px] font-medium">
        <Clock className="h-3 w-3" /> No token
      </span>
    )
  }
  if (valid) {
    return (
      <span className="inline-flex items-center gap-1.5 text-green-500 text-[11px] font-medium">
        <CheckCircle2 className="h-3 w-3" /> Valid
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-red-500 text-[11px] font-medium">
      <AlertCircle className="h-3 w-3" /> Invalid
    </span>
  )
}

function formatRelativeFrom(iso: string | null | undefined, now: number): string {
  if (!iso) return "—"
  const ms = now - new Date(iso).getTime()
  if (ms < 60_000) return "just now"
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 100) / 10
  if (s < 60) return `${s}s`
  return `${(s / 60).toFixed(1)}m`
}

function formatMetrics(metrics: Record<string, unknown>): string {
  const entries = Object.entries(metrics)
    .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== 0)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
  return entries.join(" · ") || "—"
}
