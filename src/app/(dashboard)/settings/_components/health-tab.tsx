"use client"

import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, AlertCircle, AlertTriangle, Clock, Loader2, Database } from "lucide-react"
import { cn } from "@/lib/utils"
import { KpiTile, type KpiValueTone } from "@/components/ui/kpi-tile"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { formatTimeAgo } from "@/lib/i18n/format"
import type { Locale } from "@/lib/i18n/types"
import type { DictionaryKey } from "@/lib/i18n/dictionary"

type CronRow = {
  cron_name: string
  status: "ok" | "error" | "partial"
  started_at: string
  finished_at: string
  duration_ms: number
  error_message: string | null
  metrics: Record<string, unknown>
}
type TokenRow = { service: string; is_valid: boolean; last_verified: string | null }
type ErrorRow = { cron_name: string; status: string; started_at: string; error_message: string | null }

type HealthData = {
  cronRows: CronRow[]
  tokenRows: TokenRow[]
  errorRows: ErrorRow[]
  renderNow: number
}

const EXPECTED_CRONS: ReadonlyArray<{ name: string; description: string; cadenceKey: DictionaryKey }> = [
  { name: "refresh-kpi", description: "KPI summaries + daily rollup cache", cadenceKey: "settings.health.cadence.daily_5utc" },
  { name: "refresh-cache", description: "Watch List context, billing, AI proposals overview", cadenceKey: "settings.health.cadence.daily_530utc" },
  { name: "refresh-billing-summaries", description: "Stripe billing summaries + past invoices", cadenceKey: "settings.health.cadence.hourly" },
  { name: "refresh-invoice-readiness", description: "AI invoice readiness verdicts", cadenceKey: "settings.health.cadence.every_6h" },
  { name: "refresh-proposals", description: "Per-client AI optimisation proposals", cadenceKey: "settings.health.cadence.daily" },
  { name: "refresh-watchlist-context", description: "Monday updates + Trengo summaries for watchlist AI", cadenceKey: "settings.health.cadence.daily" },
  { name: "refresh-pedro-patterns", description: "Pedro vertical-pattern synthesis", cadenceKey: "settings.health.cadence.nightly" },
  { name: "refresh-pedro-insights", description: "Unified Pedro insights cache (replaces watchlist-summaries + per-client AI calls)", cadenceKey: "settings.health.cadence.hourly" },
  { name: "pedro-auto-tasks", description: "Pedro background co-pilot - auto-creates inbox tasks for stuck-in-Action clients (with anti-spam guardrails)", cadenceKey: "settings.health.cadence.daily_7utc" },
  { name: "pedro-knowledge-proposals", description: "Pedro knowledge-base scan", cadenceKey: "settings.health.cadence.weekly" },
  { name: "inbox-automations", description: "Inbox snooze / auto-resolve rules", cadenceKey: "settings.health.cadence.hourly" },
  { name: "slack-team-watchlist", description: "Team watchlist Slack post", cadenceKey: "settings.health.cadence.hourly_gated" },
  { name: "slack-daily-watchlist", description: "Personal watchlist Slack DMs", cadenceKey: "settings.health.cadence.hourly_gated" },
  { name: "slack-team-sales", description: "Team sales Slack post", cadenceKey: "settings.health.cadence.hourly_gated" },
  { name: "slack-personal-sales", description: "Personal sales Slack DMs", cadenceKey: "settings.health.cadence.hourly_gated" },
] as const

const SERVICES_EXPECTED = ["monday", "meta", "stripe", "trengo", "slack", "fathom", "anthropic"] as const

export function HealthTab() {
  const locale = useLocale()
  const { data, isLoading, error } = useQuery<HealthData>({
    queryKey: ["admin-health"],
    queryFn: async () => {
      const r = await fetch("/api/admin/health")
      if (!r.ok) throw new Error("Failed to load health snapshot")
      return r.json()
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  if (isLoading) {
    return (
      <div className="text-xs text-muted-foreground/60 inline-flex items-center gap-2 px-1 py-4">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("settings.health.title", locale)}…
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="text-xs text-destructive px-1 py-4">
        Failed to load health snapshot.
      </div>
    )
  }

  const latestByCron = new Map<string, CronRow>()
  for (const row of data.cronRows) {
    if (!latestByCron.has(row.cron_name)) latestByCron.set(row.cron_name, row)
  }
  const tokenStatuses = Object.fromEntries(
    data.tokenRows.map((t) => [t.service, { is_valid: t.is_valid, last_verified: t.last_verified }]),
  )

  const totalCrons = EXPECTED_CRONS.length
  const okCrons = EXPECTED_CRONS.filter((c) => latestByCron.get(c.name)?.status === "ok").length
  const errorCrons = EXPECTED_CRONS.filter((c) => latestByCron.get(c.name)?.status === "error").length
  const partialCrons = EXPECTED_CRONS.filter((c) => latestByCron.get(c.name)?.status === "partial").length
  const neverRanCrons = EXPECTED_CRONS.filter((c) => !latestByCron.has(c.name)).length
  const validIntegrations = SERVICES_EXPECTED.filter((s) => tokenStatuses[s]?.is_valid).length
  const totalIntegrations = SERVICES_EXPECTED.length
  const cronStatusBreakdown = [
    errorCrons > 0 ? t("settings.health.kpi.crons_errored_one", locale, { n: errorCrons }) : null,
    partialCrons > 0 ? t("settings.health.kpi.crons_partial_one", locale, { n: partialCrons }) : null,
    neverRanCrons > 0 ? t("settings.health.kpi.crons_never_one", locale, { n: neverRanCrons }) : null,
  ].filter(Boolean).join(" · ")

  const renderNow = data.renderNow

  return (
    <div>
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
          value={`${data.errorRows.length}`}
          status={data.errorRows.length === 0 ? "good" : "bad"}
          subtitle={
            data.errorRows.length === 0
              ? t("settings.health.kpi.errors_clean", locale)
              : t("settings.health.kpi.errors_subtitle", locale)
          }
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
                  {row ? formatRelativeFrom(row.started_at, renderNow, locale) : "-"}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {row ? formatDuration(row.duration_ms) : "-"}
                </span>
                <span className="text-muted-foreground/70 truncate" title={row?.error_message ?? ""}>
                  {row?.error_message ?? (row?.metrics ? formatMetrics(row.metrics) : "-")}
                </span>
              </div>
            )
          })}
        </div>
      </section>

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
                  {tok?.last_verified
                    ? formatRelativeFrom(tok.last_verified, renderNow, locale)
                    : t("settings.health.integration.never", locale)}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      <MigrationDriftSection />

      {data.errorRows.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-medium mb-3">{t("settings.health.section.recent_errors", locale)}</h2>
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 overflow-hidden">
            {data.errorRows.map((row, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_140px_3fr] gap-x-4 px-4 py-2 border-b border-red-500/10 last:border-b-0 items-center text-xs"
              >
                <span className="font-mono text-[11px]">{row.cron_name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatRelativeFrom(row.started_at, renderNow, locale)}
                </span>
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

type MigrationsResp = {
  totalFiles: number
  appliedCount: number
  pendingCount: number
  pending: Array<{ version: string; label: string; file: string }>
}

function MigrationDriftSection() {
  const { data, isLoading, error } = useQuery<MigrationsResp>({
    queryKey: ["admin-migrations"],
    queryFn: async () => {
      const r = await fetch("/api/admin/migrations-status")
      if (!r.ok) throw new Error("Failed to load migrations status")
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) {
    return (
      <section className="mb-8">
        <h2 className="text-sm font-medium mb-3 inline-flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" /> Migrations
        </h2>
        <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Checking…
        </div>
      </section>
    )
  }
  if (error || !data) {
    return (
      <section className="mb-8">
        <h2 className="text-sm font-medium mb-3 inline-flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" /> Migrations
        </h2>
        <div className="text-xs text-destructive">Failed to load migration status.</div>
      </section>
    )
  }

  const hasDrift = data.pendingCount > 0

  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium mb-3 inline-flex items-center gap-2">
        <Database className="h-4 w-4 text-muted-foreground" /> Migrations
        <span className="text-[11px] text-muted-foreground/60 font-normal">
          {data.appliedCount}/{data.totalFiles} applied
        </span>
      </h2>
      {!hasDrift ? (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs inline-flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          All migrations applied.
        </div>
      ) : (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-red-500/20 text-xs flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-red-500" />
            <span className="font-medium text-red-500">
              {data.pendingCount} pending migration{data.pendingCount === 1 ? "" : "s"}
            </span>
            <span className="text-muted-foreground">
              - run <code className="font-mono text-[11px]">supabase db push</code> or apply via the Supabase SQL Editor.
            </span>
          </div>
          {data.pending.map((p) => (
            <div
              key={p.version}
              className="grid grid-cols-[140px_1fr] gap-x-4 px-4 py-2 border-b border-red-500/10 last:border-b-0 items-center text-xs"
            >
              <span className="font-mono text-[11px] text-muted-foreground">{p.version}</span>
              <span className="text-muted-foreground" title={p.file}>
                {p.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

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
  return (
    <KpiTile
      label={label}
      value={value}
      valueTone={status as KpiValueTone}
      sub={subtitle}
    />
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
  if (!iso) return "-"
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
  return entries.join(" · ") || "-"
}
