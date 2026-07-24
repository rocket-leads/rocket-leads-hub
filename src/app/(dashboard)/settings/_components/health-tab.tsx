"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  Loader2,
  Database,
  ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { formatTimeAgo } from "@/lib/i18n/format"
import type { Locale } from "@/lib/i18n/types"
import {
  EXPECTED_CRONS,
  HUB_FEATURES,
  classifyCron,
  rollUpFeature,
  rollUpErrors,
  overallVerdict,
  type FeatureStatus,
  type FeatureVerdict,
  type CronVerdict,
} from "@/lib/health/features"

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
    return <div className="text-xs text-destructive px-1 py-4">Failed to load health snapshot.</div>
  }

  const renderNow = data.renderNow
  const latestByCron = new Map<string, CronRow>()
  for (const row of data.cronRows) {
    if (!latestByCron.has(row.cron_name)) latestByCron.set(row.cron_name, row)
  }

  // Per-cron verdicts (works / hiccup / broken / never_ran)
  const cronVerdicts = new Map<string, CronVerdict>()
  for (const cron of EXPECTED_CRONS) {
    cronVerdicts.set(cron.name, classifyCron(cron, latestByCron.get(cron.name), renderNow))
  }

  // Hub-feature rollups
  const featureVerdicts: FeatureVerdict[] = HUB_FEATURES.map((f) => rollUpFeature(f, cronVerdicts))
  const overall = overallVerdict(featureVerdicts)

  // Rolled-up errors (group 30 retry rows into ~3 root causes)
  const errorGroups = rollUpErrors(data.errorRows)

  const tokenStatuses = Object.fromEntries(
    data.tokenRows.map((t) => [t.service, { is_valid: t.is_valid, last_verified: t.last_verified }]),
  )
  const invalidIntegrations = SERVICES_EXPECTED.filter((s) => tokenStatuses[s]?.is_valid === false)

  return (
    <div>
      <OverallBanner overall={overall} locale={locale} />

      <section className="mb-8 mt-6">
        <h2 className="section-title mb-4">{t("settings.health.features.title", locale)}</h2>
        <div className="rounded-lg border border-border/40 divide-y divide-border/30">
          {featureVerdicts.map((fv) => (
            <FeatureRow key={fv.feature.id} verdict={fv} renderNow={renderNow} locale={locale} />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="section-title mb-4">{t("settings.health.section.integrations", locale)}</h2>
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
        {invalidIntegrations.length > 0 && (
          <p className="text-[11px] text-muted-foreground mt-2">
            {t("settings.health.integration.fix_hint", locale)}
          </p>
        )}
      </section>

      <MigrationDriftSection locale={locale} />

      {errorGroups.length > 0 && (
        <section className="mb-8">
          <h2 className="section-title mb-4">
            {t("settings.health.recurring.title", locale)}{" "}
            <span className="text-[11px] text-muted-foreground/60 font-normal">
              {t("settings.health.recurring.subtitle", locale, { n: data.errorRows.length })}
            </span>
          </h2>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 divide-y divide-amber-500/15">
            {errorGroups.map((g) => (
              <div key={g.cronName} className="px-4 py-3 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  <span className="font-mono text-[12px]">{g.cronName}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {t("settings.health.recurring.count", locale, {
                      n: g.count,
                      last: formatRelativeFrom(g.lastSeen, renderNow, locale),
                    })}
                  </span>
                </div>
                <ul className="text-muted-foreground/80 ml-5 list-disc">
                  {g.uniqueMessages.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <TechnicalDetails
        crons={EXPECTED_CRONS}
        cronVerdicts={cronVerdicts}
        latestByCron={latestByCron}
        renderNow={renderNow}
        locale={locale}
      />
    </div>
  )
}

function OverallBanner({
  overall,
  locale,
}: {
  overall: { status: FeatureStatus; brokenCount: number; hiccupCount: number }
  locale: Locale
}) {
  const tone =
    overall.status === "working" ? "good" : overall.status === "hiccup" ? "warn" : "bad"
  const Icon =
    overall.status === "working" ? CheckCircle2 : overall.status === "hiccup" ? AlertTriangle : AlertCircle
  const title =
    overall.status === "working"
      ? t("settings.health.overall.all_running", locale)
      : overall.status === "hiccup"
        ? overall.hiccupCount === 1
          ? t("settings.health.overall.hiccup_one", locale)
          : t("settings.health.overall.hiccup_many", locale, { n: overall.hiccupCount })
        : overall.brokenCount === 1
          ? t("settings.health.overall.broken_one", locale)
          : t("settings.health.overall.broken_many", locale, { n: overall.brokenCount })
  const subtitle =
    overall.status === "working"
      ? overall.hiccupCount > 0
        ? overall.hiccupCount === 1
          ? t("settings.health.overall.also_hiccup_one", locale)
          : t("settings.health.overall.also_hiccup_many", locale, { n: overall.hiccupCount })
        : t("settings.health.overall.all_running_sub", locale)
      : overall.status === "hiccup"
        ? t("settings.health.overall.hiccup_sub", locale)
        : t("settings.health.overall.broken_sub", locale)

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 flex items-start gap-3",
        tone === "good" && "border-emerald-500/30 bg-emerald-500/5",
        tone === "warn" && "border-amber-500/30 bg-amber-500/5",
        tone === "bad" && "border-red-500/30 bg-red-500/5",
      )}
    >
      <Icon
        className={cn(
          "h-5 w-5 mt-0.5 shrink-0",
          tone === "good" && "text-emerald-500",
          tone === "warn" && "text-amber-500",
          tone === "bad" && "text-red-500",
        )}
      />
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
      </div>
    </div>
  )
}

function FeatureRow({
  verdict,
  renderNow,
  locale,
}: {
  verdict: FeatureVerdict
  renderNow: number
  locale: Locale
}) {
  const tone =
    verdict.status === "working" ? "good" : verdict.status === "hiccup" ? "warn" : "bad"
  return (
    <div className="px-4 py-3 grid grid-cols-[200px_1fr_140px] gap-x-4 items-start text-xs">
      <div className="flex items-center gap-2">
        <StatusDot tone={tone} />
        <span className="font-medium text-foreground">{verdict.feature.name}</span>
      </div>
      <div className="text-muted-foreground leading-snug">
        {verdict.summary}
        {verdict.status !== "working" && (
          <div className="text-[11px] text-muted-foreground/60 mt-0.5">
            {verdict.feature.description}
          </div>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground/70 tabular-nums text-right">
        {verdict.freshAgeMs !== null
          ? t("settings.health.feature.last_fresh", locale, {
              age: formatTimeAgo(new Date(renderNow - verdict.freshAgeMs).toISOString(), locale, renderNow),
            })
          : t("settings.health.feature.never_fresh", locale)}
      </div>
    </div>
  )
}

function StatusDot({ tone }: { tone: "good" | "warn" | "bad" }) {
  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full shrink-0",
        tone === "good" && "bg-emerald-500",
        tone === "warn" && "bg-amber-500",
        tone === "bad" && "bg-red-500",
      )}
    />
  )
}

function TechnicalDetails({
  crons,
  cronVerdicts,
  latestByCron,
  renderNow,
  locale,
}: {
  crons: typeof EXPECTED_CRONS
  cronVerdicts: Map<string, CronVerdict>
  latestByCron: Map<string, CronRow>
  renderNow: number
  locale: Locale
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className="mb-8">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
        />
        {t("settings.health.tech.toggle", locale)}
      </button>
      {open && (
        <div className="mt-3 rounded-lg border border-border/40 overflow-hidden">
          <div className="grid grid-cols-[1.5fr_1.5fr_100px_120px_100px_2fr] gap-x-4 px-4 py-2.5 border-b border-border/40 bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground/70">
            <span>{t("settings.health.col.cron", locale)}</span>
            <span>{t("settings.health.col.description", locale)}</span>
            <span>{t("settings.health.col.status", locale)}</span>
            <span>{t("settings.health.col.last_run", locale)}</span>
            <span>{t("settings.health.col.duration", locale)}</span>
            <span>{t("settings.health.col.notes", locale)}</span>
          </div>
          {crons.map((c) => {
            const row = latestByCron.get(c.name)
            const verdict = cronVerdicts.get(c.name)
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
                <CronStatusPill status={status} verdict={verdict?.status} locale={locale} />
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
      )}
    </section>
  )
}

type MigrationsResp = {
  totalFiles: number
  appliedCount: number
  pendingCount: number
  pending: Array<{ version: string; label: string; file: string }>
}

function MigrationDriftSection({ locale }: { locale: Locale }) {
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

  // Skip the whole section when nothing's pending - the overall banner already
  // signals green and a "0 pending" line is just noise.
  if (!hasDrift) return null

  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium mb-3 inline-flex items-center gap-2">
        <Database className="h-4 w-4 text-muted-foreground" /> Migrations
        <span className="text-[11px] text-muted-foreground/60 font-normal">
          {data.appliedCount}/{data.totalFiles} applied
        </span>
      </h2>
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
    </section>
  )
}

function CronStatusPill({
  status,
  verdict,
  locale,
}: {
  status: "ok" | "error" | "partial" | "never_ran"
  verdict: CronVerdict["status"] | undefined
  locale: Locale
}) {
  // Use the rolled-up verdict to show "hiccup" instead of "error" when the
  // failure is fresh enough to retry on its own — keeps the pill aligned with
  // the feature-level summary so a green feature can't show a red cron pill.
  if (verdict === "ok" || status === "ok") {
    return (
      <span className="inline-flex items-center gap-1.5 text-green-500 text-[11px] font-medium">
        <CheckCircle2 className="h-3 w-3" /> {t("settings.health.status.ok", locale)}
      </span>
    )
  }
  if (verdict === "hiccup") {
    return (
      <span className="inline-flex items-center gap-1.5 text-amber-400 text-[11px] font-medium">
        <AlertTriangle className="h-3 w-3" /> {t("settings.health.status.hiccup", locale)}
      </span>
    )
  }
  if (status === "error" || verdict === "broken") {
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
