import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, CheckCircle2, AlertCircle, AlertTriangle, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { getUserLocale } from "@/lib/i18n/server"
import { t } from "@/lib/i18n/t"
import { formatTimeAgo } from "@/lib/i18n/format"
import type { Locale } from "@/lib/i18n/types"
import type { DictionaryKey } from "@/lib/i18n/dictionary"

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
 *  /api/cron/* directories.
 *
 *  Descriptions stay English — they're admin-tech-facing and reference
 *  service names (Sonnet, Stripe, Trengo, etc) that don't translate. The
 *  cadence is dictionary-keyed so "dagelijks 05:00 UTC" flips when the
 *  admin toggles their UI locale. */
const EXPECTED_CRONS: ReadonlyArray<{ name: string; description: string; cadenceKey: DictionaryKey }> = [
  { name: "refresh-kpi", description: "KPI summaries + daily rollup cache", cadenceKey: "settings.health.cadence.daily_5utc" },
  { name: "refresh-cache", description: "Watch List context, billing, AI proposals overview", cadenceKey: "settings.health.cadence.daily_530utc" },
  { name: "refresh-billing-summaries", description: "Stripe billing summaries + past invoices", cadenceKey: "settings.health.cadence.hourly" },
  { name: "refresh-invoice-readiness", description: "AI invoice readiness verdicts", cadenceKey: "settings.health.cadence.every_6h" },
  { name: "refresh-proposals", description: "Per-client AI optimisation proposals", cadenceKey: "settings.health.cadence.daily" },
  { name: "refresh-watchlist-context", description: "Monday updates + Trengo summaries for watchlist AI", cadenceKey: "settings.health.cadence.daily" },
  { name: "refresh-pedro-patterns", description: "Pedro vertical-pattern synthesis", cadenceKey: "settings.health.cadence.nightly" },
  { name: "refresh-pedro-insights", description: "Unified Pedro insights cache (replaces watchlist-summaries + per-client AI calls)", cadenceKey: "settings.health.cadence.hourly" },
  { name: "pedro-auto-tasks", description: "Pedro background co-pilot — auto-creates inbox tasks for stuck-in-Action clients (with anti-spam guardrails)", cadenceKey: "settings.health.cadence.daily_7utc" },
  { name: "pedro-knowledge-proposals", description: "Pedro knowledge-base scan", cadenceKey: "settings.health.cadence.weekly" },
  { name: "sync-campaign-status", description: "Live ↔ On Hold flip + onboarding → LAUNCH", cadenceKey: "settings.health.cadence.daily" },
  { name: "inbox-automations", description: "Inbox snooze / auto-resolve rules", cadenceKey: "settings.health.cadence.hourly" },
  { name: "slack-team-watchlist", description: "Team watchlist Slack post", cadenceKey: "settings.health.cadence.hourly_gated" },
  { name: "slack-daily-watchlist", description: "Personal watchlist Slack DMs", cadenceKey: "settings.health.cadence.hourly_gated" },
  { name: "slack-team-sales", description: "Team sales Slack post", cadenceKey: "settings.health.cadence.hourly_gated" },
  { name: "slack-personal-sales", description: "Personal sales Slack DMs", cadenceKey: "settings.health.cadence.hourly_gated" },
] as const

const SERVICES_EXPECTED = ["monday", "meta", "stripe", "trengo", "slack", "fathom", "anthropic"] as const

export default async function HealthPage() {
  const session = await auth()
  if (!session || session.user.role !== "admin") redirect("/home")

  const supabase = await createAdminClient()
  const locale = await getUserLocale(session.user.id)

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

  // Compact subtitle of mixed counts ("3 errored · 1 partial") — built
  // outside JSX so the t() pluralisation reads cleaner.
  const cronStatusBreakdown = [
    errorCrons > 0 ? t("settings.health.kpi.crons_errored_one", locale, { n: errorCrons }) : null,
    partialCrons > 0 ? t("settings.health.kpi.crons_partial_one", locale, { n: partialCrons }) : null,
    neverRanCrons > 0 ? t("settings.health.kpi.crons_never_one", locale, { n: neverRanCrons }) : null,
  ].filter(Boolean).join(" · ")

  return (
    <div>
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("settings.health.back", locale)}
      </Link>

      <div className="mb-6">
        <h1 className="text-[22px] font-heading font-semibold tracking-tight leading-tight">{t("settings.health.title", locale)}</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          {t("settings.health.subtitle", locale)}
        </p>
      </div>

      {/* Top-line summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SummaryCard
          label={t("settings.health.kpi.crons_ok", locale)}
          value={`${okCrons}/${totalCrons}`}
          status={okCrons === totalCrons ? "good" : okCrons >= totalCrons * 0.75 ? "warn" : "bad"}
          subtitle={
            errorCrons === 0 && partialCrons === 0 && neverRanCrons === 0
              ? t("settings.health.kpi.crons_clear", locale)
              : cronStatusBreakdown
          }
        />
        <SummaryCard
          label={t("settings.health.kpi.integrations_valid", locale)}
          value={`${validIntegrations}/${totalIntegrations}`}
          status={validIntegrations === totalIntegrations ? "good" : validIntegrations >= 5 ? "warn" : "bad"}
          subtitle={
            validIntegrations === totalIntegrations
              ? t("settings.health.kpi.integrations_all_valid", locale)
              : t("settings.health.kpi.integrations_need_attention", locale, { n: totalIntegrations - validIntegrations })
          }
        />
        <SummaryCard
          label={t("settings.health.kpi.errors_24h", locale)}
          value={`${errorRows?.length ?? 0}`}
          status={(errorRows?.length ?? 0) === 0 ? "good" : "bad"}
          subtitle={(errorRows?.length ?? 0) === 0 ? t("settings.health.kpi.errors_clean", locale) : t("settings.health.kpi.errors_subtitle", locale)}
        />
        <SummaryCard
          label={t("settings.health.kpi.last_kpi", locale)}
          value={formatRelativeFrom(latestByCron.get("refresh-kpi")?.started_at, renderNow, locale)}
          status={(() => {
            const last = latestByCron.get("refresh-kpi")
            if (!last) return "bad"
            if (last.status !== "ok") return "bad"
            const ageH = (renderNow - new Date(last.started_at).getTime()) / 3600000
            return ageH > 30 ? "warn" : "good"
          })()}
          subtitle={t("settings.health.kpi.last_kpi_subtitle", locale)}
        />
      </div>

      {/* Crons table */}
      <section className="mb-8">
        <h2 className="text-sm font-medium mb-3">{t("settings.health.section.crons", locale)}</h2>
        <div className="rounded-lg border border-border/40 overflow-hidden">
          <div className="grid grid-cols-[1.5fr_1.5fr_100px_120px_100px_2fr] gap-x-4 px-4 py-2.5 border-b border-border/40 bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground/70">
            <span>{t("settings.health.col.cron", locale)}</span>
            <span>{t("settings.health.col.description", locale)}</span>
            <span>{t("settings.health.col.status", locale)}</span>
            <span>{t("settings.health.col.last_run", locale)}</span>
            <span>{t("settings.health.col.duration", locale)}</span>
            <span>{t("settings.health.col.notes", locale)}</span>
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
                  <div className="text-[10px] text-muted-foreground/50">{t(c.cadenceKey, locale)}</div>
                </div>
                <span className="text-muted-foreground leading-snug">{c.description}</span>
                <CronStatusPill status={status} locale={locale} />
                <span className="text-muted-foreground tabular-nums">
                  {row ? formatRelativeFrom(row.started_at, renderNow, locale) : "—"}
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
        <h2 className="text-sm font-medium mb-3">{t("settings.health.section.integrations", locale)}</h2>
        <div className="rounded-lg border border-border/40 overflow-hidden">
          <div className="grid grid-cols-[1fr_120px_2fr] gap-x-4 px-4 py-2.5 border-b border-border/40 bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground/70">
            <span>{t("settings.health.col.service", locale)}</span>
            <span>{t("settings.health.col.status", locale)}</span>
            <span>{t("settings.health.col.last_verified", locale)}</span>
          </div>
          {SERVICES_EXPECTED.map((service) => {
            const tok = tokenStatuses[service]
            return (
              <div
                key={service}
                className="grid grid-cols-[1fr_120px_2fr] gap-x-4 px-4 py-2.5 border-b border-border/30 last:border-b-0 items-center text-xs"
              >
                <span className="font-medium capitalize">{service}</span>
                <IntegrationStatusPill valid={tok?.is_valid ?? null} locale={locale} />
                <span className="text-muted-foreground tabular-nums">
                  {tok?.last_verified ? formatRelativeFrom(tok.last_verified, renderNow, locale) : t("settings.health.integration.never", locale)}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {/* Recent errors */}
      {(errorRows?.length ?? 0) > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-medium mb-3">{t("settings.health.section.recent_errors", locale)}</h2>
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 overflow-hidden">
            {(errorRows ?? []).map((row, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_140px_3fr] gap-x-4 px-4 py-2 border-b border-red-500/10 last:border-b-0 items-center text-xs"
              >
                <span className="font-mono text-[11px]">{row.cron_name}</span>
                <span className="text-muted-foreground tabular-nums">{formatRelativeFrom(row.started_at, renderNow, locale)}</span>
                <span className="text-red-400 truncate" title={row.error_message ?? ""}>
                  {row.error_message ?? t("settings.health.recent_errors.no_message", locale)}
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

function CronStatusPill({
  status,
  locale,
}: {
  status: "ok" | "error" | "partial" | "never_ran"
  locale: Locale
}) {
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1.5 text-green-500 text-[11px] font-medium">
        <CheckCircle2 className="h-3 w-3" /> {t("settings.health.status.ok", locale)}
      </span>
    )
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-red-500 text-[11px] font-medium">
        <AlertCircle className="h-3 w-3" /> {t("settings.health.status.error", locale)}
      </span>
    )
  }
  if (status === "partial") {
    return (
      <span className="inline-flex items-center gap-1.5 text-amber-400 text-[11px] font-medium">
        <AlertTriangle className="h-3 w-3" /> {t("settings.health.status.partial", locale)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground/50 text-[11px] font-medium">
      <Clock className="h-3 w-3" /> {t("settings.health.status.never_ran", locale)}
    </span>
  )
}

function IntegrationStatusPill({ valid, locale }: { valid: boolean | null; locale: Locale }) {
  if (valid === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground/50 text-[11px] font-medium">
        <Clock className="h-3 w-3" /> {t("settings.health.integration.no_token", locale)}
      </span>
    )
  }
  if (valid) {
    return (
      <span className="inline-flex items-center gap-1.5 text-green-500 text-[11px] font-medium">
        <CheckCircle2 className="h-3 w-3" /> {t("settings.health.integration.valid", locale)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-red-500 text-[11px] font-medium">
      <AlertCircle className="h-3 w-3" /> {t("settings.health.integration.invalid", locale)}
    </span>
  )
}

function formatRelativeFrom(iso: string | null | undefined, now: number, locale: Locale): string {
  if (!iso) return "—"
  return formatTimeAgo(iso, locale, now)
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
