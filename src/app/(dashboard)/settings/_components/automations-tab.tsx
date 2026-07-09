"use client"

import { useState, useTransition } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Loader2,
  MessageSquare,
  Play,
  Send,
  Sparkles,
  TrendingDown,
  Users,
  Zap,
} from "lucide-react"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import {
  saveSlackChannelId,
  setInboxAutomationRule,
  triggerInboxAutomationsNow,
  updateCloserSlackId,
  updateNotificationConfig,
} from "../actions"
import type { InboxAutomationRules } from "../types"
import type { AllNotificationConfigs, NotificationKey } from "@/lib/slack/notification-config"
import type { AutomationRunResult, CreatedItem } from "@/lib/inbox/automations"

// ────────────────────────────────────────────────────────────────────────────
//  Shared chrome
// ────────────────────────────────────────────────────────────────────────────

function AutomationCard({
  icon,
  tone,
  title,
  status,
  description,
  children,
}: {
  icon: React.ReactNode
  /** Background tone for the icon tile. */
  tone: "amber" | "purple" | "emerald" | "muted"
  title: string
  /** Top-right control area - typically a toggle or action buttons. */
  status?: React.ReactNode
  description: string
  children?: React.ReactNode
}) {
  const tones: Record<typeof tone, string> = {
    amber: "bg-amber-500/10 text-amber-500",
    purple: "bg-purple-500/10 text-purple-500",
    emerald: "bg-emerald-500/10 text-emerald-500",
    muted: "bg-muted text-muted-foreground",
  }
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-4 transition-colors">
      <div className="flex items-start gap-4">
        <div
          className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${tones[tone]}`}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <p className="text-sm font-semibold">{title}</p>
            {status}
          </div>
          <p className="text-xs text-muted-foreground/80 leading-relaxed mb-3">
            {description}
          </p>
          {children}
        </div>
      </div>
    </div>
  )
}

function SectionHeader({
  title,
  icon,
}: {
  title: string
  icon: React.ReactNode
}) {
  return (
    <h3 className="text-sm font-medium mb-3 inline-flex items-center gap-2">
      {icon}
      {title}
    </h3>
  )
}

function MetaGrid({
  items,
}: {
  items: { label: string; value: React.ReactNode }[]
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
      {items.map((it, i) => (
        <div key={i}>
          <span className="text-muted-foreground/40 uppercase tracking-wider">
            {it.label}
          </span>
          <div className="text-foreground/80 mt-0.5">{it.value}</div>
        </div>
      ))}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//  Inbox automations
// ────────────────────────────────────────────────────────────────────────────

type RuleConfig = {
  key: keyof InboxAutomationRules
  title: string
  description: string
  trigger: string
  effect: string
  icon: typeof CreditCard
}

const INBOX_RULES: RuleConfig[] = [
  {
    key: "payment_overdue_task",
    title: "Payment overdue → high-priority task",
    description:
      "When a Stripe invoice goes overdue for a Live client, the daily cron creates a high-priority task assigned to that client's Account Manager. Onboarding, On Hold and Churned clients are skipped - chasing payments on those accounts adds noise without action. Idempotent - one task per overdue invoice.",
    trigger: "Stripe invoice status becomes overdue (Live clients only)",
    effect: "Task created · assigned to AM · priority high · due today",
    icon: CreditCard,
  },
  {
    key: "positive_client_signal_cpl_drop",
    title: "Positive client signal → AM share-the-win task",
    description:
      "When a client's CPL drops 50% or more compared to the previous period (last 7d or last 30d), the cron drafts a short, informal Dutch update message - using recent Trengo conversations to match tone-of-voice - and creates a task for the AM with the message ready to copy-paste to the client. Idempotent: one signal per client per period in any 14-day window.",
    trigger: "CPL drops ≥50% vs previous period (7d or 30d)",
    effect: "Task created · AI-drafted Dutch update in body · assigned to AM",
    icon: TrendingDown,
  },
  {
    key: "auto_complete_invoice_tasks",
    title: "Stripe invoice sent → auto-complete the finance task",
    description:
      "Closes the loop on the previous rule. When a non-draft Stripe invoice appears for a client whose finance task is still open, the cron marks the task done and notes the invoice ID in the body. 7-day grace before the due date so an early send still counts. Skips tasks that are already in progress (someone is actively handling them).",
    trigger: "Open finance task + matching Stripe invoice exists",
    effect: "Task status → done · audit note appended · auto_completed flag in source_ref",
    icon: CheckCircle2,
  },
  {
    key: "dedup_overlapping_tasks",
    title: "AI dedup → cancel duplicate tasks across sources",
    description:
      "Same logical action can land in the inbox via multiple paths (Trengo classification + Fathom action item + automation cron). Claude Haiku scans recently-created open tasks per client and merges semantic duplicates: the OLDEST in each group survives, the rest get cancelled with an audit note pointing back at the kept task. Conservative defaults - confidence threshold ≥0.85, only same-client groups, only tasks created in the last 7 days. Reversible via Reopen on the cancelled rows.",
    trigger: "≥2 open tasks for the same client created in last 7d",
    effect: "Newer duplicates → cancelled · source_ref.duplicate_of set · audit note in body",
    icon: Sparkles,
  },
]

function InboxAutomationsSection({ rules }: { rules: InboxAutomationRules }) {
  const locale = useLocale()
  const [local, setLocal] = useState<InboxAutomationRules>(rules)
  const [pending, setPending] = useState<keyof InboxAutomationRules | null>(null)
  const [, startTransition] = useTransition()

  function toggle(rule: keyof InboxAutomationRules) {
    const next = !local[rule]
    setLocal((s) => ({ ...s, [rule]: next }))
    setPending(rule)
    startTransition(async () => {
      try {
        await setInboxAutomationRule(rule, next)
      } catch (e) {
        setLocal((s) => ({ ...s, [rule]: !next }))
        console.error("Failed to update rule", e)
      } finally {
        setPending(null)
      }
    })
  }

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("settings.inbox.title", locale)}
        icon={<Zap className="h-3.5 w-3.5 text-amber-500" />}
      />

      <RunNowPanel />

      <div className="space-y-3">
        {INBOX_RULES.map((r) => {
          const enabled = local[r.key]
          const isPending = pending === r.key
          const Icon = r.icon
          return (
            <AutomationCard
              key={r.key}
              icon={<Icon className="h-4 w-4" />}
              tone={enabled ? "amber" : "muted"}
              title={r.title}
              status={
                <ToggleSwitch
                  enabled={enabled}
                  pending={isPending}
                  onClick={() => toggle(r.key)}
                />
              }
              description={r.description}
            >
              <MetaGrid
                items={[
                  { label: t("settings.inbox.trigger", locale), value: r.trigger },
                  { label: t("settings.inbox.effect", locale), value: r.effect },
                ]}
              />
            </AutomationCard>
          )
        })}
      </div>

      <p className="text-[11px] text-muted-foreground/50 italic">
        {t("settings.inbox.footer_more", locale)}
      </p>
    </section>
  )
}

function ToggleSwitch({
  enabled,
  pending,
  onClick,
}: {
  enabled: boolean
  pending: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onClick}
      disabled={pending}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
        enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
      } ${pending ? "opacity-60" : ""}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          enabled ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
      {pending && (
        <Loader2 className="absolute inset-0 m-auto h-3 w-3 animate-spin text-muted-foreground" />
      )}
    </button>
  )
}

function RunNowPanel() {
  const locale = useLocale()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<AutomationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCreated, setShowCreated] = useState(true)
  const [showSkipped, setShowSkipped] = useState(false)

  async function run() {
    setRunning(true)
    setError(null)
    try {
      const r = await triggerInboxAutomationsNow()
      setResult(r)
      setShowCreated(true)
      setShowSkipped(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.inbox.run.error.failed", locale))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold inline-flex items-center gap-2">
            <Play className="h-3.5 w-3.5 text-foreground/70" />
            {t("settings.inbox.run.title", locale)}
          </p>
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            {t("settings.inbox.run.subtitle_before", locale)}
            <span className="font-medium text-foreground/80">
              {t("settings.inbox.run.subtitle_you", locale)}
            </span>
            {t("settings.inbox.run.subtitle_with", locale)}
            <span className="font-mono">[TEST]</span>
            {t("settings.inbox.run.subtitle_after", locale)}
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted/60 transition-colors disabled:opacity-60 shrink-0"
        >
          {running ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("settings.inbox.run.action.running", locale)}
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" />
              {t("settings.inbox.run.action.run", locale)}
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2 pt-1 border-t border-border/40">
          <div className="text-[11px] text-muted-foreground/80 flex items-center gap-2 flex-wrap">
            <span>{t("settings.inbox.result.last_run", locale, { duration: result.duration })}</span>
            <span>·</span>
            <span>
              <span className="text-emerald-500 font-medium">{result.created.length}</span>{" "}
              {t("settings.inbox.result.created", locale)}
            </span>
            <span>·</span>
            <span>
              <span className="text-amber-500 font-medium">{result.skippedTotal}</span>{" "}
              {t("settings.inbox.result.skipped", locale)}
            </span>
            {result.reason && <span className="italic">- {result.reason}</span>}
          </div>

          {result.created.length > 0 && (
            <ResultSection
              title={t("settings.inbox.result.section_created", locale, {
                n: String(result.created.length),
              })}
              open={showCreated}
              onToggle={() => setShowCreated((s) => !s)}
            >
              {result.created.map((item, i) => (
                <CreatedRow key={i} item={item} locale={locale} />
              ))}
            </ResultSection>
          )}

          {result.skippedTotal > 0 && (
            <ResultSection
              title={t("settings.inbox.result.section_skipped", locale, {
                n: String(result.skippedTotal),
              })}
              open={showSkipped}
              onToggle={() => setShowSkipped((s) => !s)}
            >
              {result.skipped.map((s, i) => (
                <p key={i} className="text-[11px] py-0.5">
                  <span className="font-mono text-muted-foreground/60">{s.reason}</span>
                  {s.client && <span className="ml-2">{s.client}</span>}
                  {s.detail && (
                    <span className="ml-2 text-muted-foreground/50">- {s.detail}</span>
                  )}
                </p>
              ))}
              {result.skippedTotal > result.skipped.length && (
                <p className="text-[10px] text-muted-foreground/40 italic mt-1">
                  {t("settings.inbox.result.truncated", locale, {
                    n: String(result.skippedTotal - result.skipped.length),
                  })}
                </p>
              )}
            </ResultSection>
          )}

          {result.created.length === 0 && result.skippedTotal === 0 && !result.reason && (
            <p className="text-[11px] text-muted-foreground italic">
              {t("settings.inbox.result.empty", locale)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ResultSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-medium text-muted-foreground/70 hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open && <div className="mt-1.5 ml-4 space-y-1">{children}</div>}
    </div>
  )
}

function CreatedRow({ item, locale }: { item: CreatedItem; locale: Locale }) {
  if (item.rule === "payment_overdue_task") {
    return (
      <div className="text-[11px] py-0.5 flex items-baseline gap-2">
        <span className="text-amber-500 font-medium">
          {t("settings.inbox.row.payment_overdue", locale)}
        </span>
        <span className="text-foreground/80">{item.clientName}</span>
        <span className="text-muted-foreground/60">→ {item.assigneeName}</span>
        <span className="text-muted-foreground/60 tabular-nums">
          €
          {item.amount.toLocaleString(locale === "nl" ? "nl-NL" : "en-GB", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      </div>
    )
  }
  if (item.rule === "auto_complete_invoice_tasks") {
    return (
      <div className="text-[11px] py-0.5 flex items-baseline gap-2">
        <span className="text-emerald-500 font-medium">
          {t("settings.inbox.row.auto_completed", locale)}
        </span>
        <span className="text-foreground/80">{item.clientName}</span>
        <span className="text-muted-foreground/60 tabular-nums">
          {t("settings.inbox.row.invoice_short", locale, { id: item.invoiceId.slice(0, 12) })}
        </span>
      </div>
    )
  }
  if (item.rule === "dedup_overlapping_tasks") {
    return (
      <div className="text-[11px] py-0.5 flex items-baseline gap-2">
        <span className="text-violet-500 font-medium">
          {t("settings.inbox.row.deduped", locale)}
        </span>
        <span className="text-foreground/80">{item.clientName}</span>
        <span className="text-muted-foreground/80 truncate">{item.keptTaskTitle}</span>
        <span className="text-muted-foreground/60 tabular-nums">
          −{item.cancelledTaskIds.length} ({Math.round(item.confidence * 100)}%)
        </span>
      </div>
    )
  }
  return (
    <div className="text-[11px] py-0.5 flex items-baseline gap-2">
      <span className="text-emerald-500 font-medium">
        {t("settings.inbox.row.cpl_drop", locale, { period: item.period })}
      </span>
      <span className="text-foreground/80">{item.clientName}</span>
      <span className="text-muted-foreground/60">→ {item.assigneeName}</span>
      <span className="text-muted-foreground/60 tabular-nums">
        −{item.dropPct}% (€{item.currCpl.toFixed(2)} vs €{item.prevCpl.toFixed(2)})
      </span>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//  Slack notifications
// ────────────────────────────────────────────────────────────────────────────

type Recipient = {
  name: string | null
  email: string
  hasSlack: boolean
}

type Closer = {
  name: string
  slackId: string | null
}

type AudienceKind = "hub-users" | "closers"
type ChannelKey = "team_watchlist" | "sales"

type NotificationDef = {
  id: string
  title: string
  destination: "dm" | "channel"
  /** Static label fallback for cards without an editable channel ID. */
  channelLabel: string
  /** When set, the card renders an editable input for the channel ID. */
  channelKey?: ChannelKey
  channelId?: string | null
  schedule: string
  previewEndpoint: string
  cronEndpoint: string
  description: string
  examplePreview: string
  audience: AudienceKind
}

function NotificationsSection({
  slackConnected,
  recipients,
  teamChannelId,
  salesChannelId,
  closers: initialClosers,
  notificationConfigs,
}: {
  slackConnected: boolean
  recipients: Recipient[]
  teamChannelId: string | null
  salesChannelId: string | null
  closers: Closer[]
  notificationConfigs: AllNotificationConfigs
}) {
  const locale = useLocale()
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})

  // Enabled/disabled state per notification, seeded from saved config. The daily
  // cron only fires when enabled (shouldRunNow); Preview/Send-now still work even
  // when off, so a disabled card can still be tested manually.
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    const seed: Record<string, boolean> = {}
    for (const [key, cfg] of Object.entries(notificationConfigs)) seed[key] = cfg.enabled
    return seed
  })
  const [togglePending, setTogglePending] = useState<Record<string, boolean>>({})
  const [, startEnabledTransition] = useTransition()

  function toggleEnabled(key: NotificationKey) {
    const next = !enabled[key]
    setEnabled((s) => ({ ...s, [key]: next }))
    setTogglePending((s) => ({ ...s, [key]: true }))
    startEnabledTransition(async () => {
      try {
        await updateNotificationConfig(key, { enabled: next })
      } catch (e) {
        setEnabled((s) => ({ ...s, [key]: !next })) // revert on failure
        console.error("Failed to toggle notification", e)
      } finally {
        setTogglePending((s) => ({ ...s, [key]: false }))
      }
    })
  }

  const closersQuery = useQuery<{ closers: Closer[] }>({
    queryKey: ["settings-closers"],
    queryFn: () => fetch("/api/admin/settings/closer-names").then((r) => r.json()),
    staleTime: 30 * 60 * 1000,
    initialData: initialClosers.length > 0 ? { closers: initialClosers } : undefined,
  })
  const closers = closersQuery.data?.closers ?? initialClosers

  async function runPreview(id: string, endpoint: string) {
    setBusy((b) => ({ ...b, [id]: true }))
    setResults((r) => ({ ...r, [id]: { ok: false, message: "" } }))
    try {
      const res = await fetch(endpoint, { method: "POST" })
      const data = await res.json()
      setResults((r) => ({ ...r, [id]: data }))
    } catch {
      setResults((r) => ({
        ...r,
        [id]: { ok: false, message: t("settings.notifications.request_failed", locale) },
      }))
    } finally {
      setBusy((b) => ({ ...b, [id]: false }))
    }
  }

  async function runSendNow(id: string, def: NotificationDef) {
    const audienceLabel =
      def.destination === "dm"
        ? def.audience === "closers"
          ? "alle closers/setters met een Slack ID"
          : "alle Hub users met een Slack ID"
        : `het Slack channel (${def.channelLabel.toLowerCase()})`
    const confirmed = window.confirm(
      `Verstuur "${def.title}" nu naar ${audienceLabel}?\n\nDit is geen test - de echte ontvangers krijgen het bericht.`,
    )
    if (!confirmed) return

    setBusy((b) => ({ ...b, [id]: true }))
    setResults((r) => ({ ...r, [id]: { ok: false, message: "" } }))
    try {
      const res = await fetch(`${def.cronEndpoint}?force=1`, { method: "GET" })
      const data = await res.json().catch(() => ({}))
      const ok = res.ok && data?.ok !== false
      const message = ok
        ? data?.skipped
          ? `Skipped: ${data.skipped}`
          : t("settings.notifications.sent_to_recipients", locale)
        : data?.error || `Failed (HTTP ${res.status})`
      setResults((r) => ({ ...r, [id]: { ok, message } }))
    } catch {
      setResults((r) => ({
        ...r,
        [id]: { ok: false, message: t("settings.notifications.request_failed", locale) },
      }))
    } finally {
      setBusy((b) => ({ ...b, [id]: false }))
    }
  }

  const recipientsWithSlack = recipients.filter((r) => r.hasSlack)
  const recipientsMissing = recipients.filter((r) => !r.hasSlack)

  const notifications: NotificationDef[] = [
    {
      id: "personal_watchlist",
      title: "Personal Watchlist Summary",
      destination: "dm",
      channelLabel: "DM · per Hub user",
      schedule: "Daily · 06:00 Europe/Amsterdam",
      previewEndpoint: "/api/slack/preview-daily-watchlist",
      cronEndpoint: "/api/cron/slack-daily-watchlist",
      audience: "hub-users",
      description:
        "Every Hub user with a Slack ID gets a personal morning DM about their own clients (filtered by column mapping). Focuses on changes since yesterday - new concerns, wins, persistent issues - not a copy of the watchlist.",
      examplePreview: `🌅 Goedemorgen. Een paar bewegingen overnight.

*Health score: 50% · ↑ 7pt vs gisteren · 7d avg building…*
🟢 20 healthy · 🟡 6 watch · 🔴 14 action

*⚠️ 7 nieuwe concerns vandaag*
• ProSteel → Action (was Healthy) - CPL up 43%
…en 5 meer

Open Watchlist`,
    },
    {
      id: "team_watchlist",
      title: "Team Watchlist Summary",
      destination: "channel",
      channelLabel: "Slack channel",
      channelKey: "team_watchlist",
      channelId: teamChannelId,
      schedule: "Daily · 06:00 Europe/Amsterdam",
      previewEndpoint: "/api/slack/preview-team-watchlist",
      cronEndpoint: "/api/cron/slack-team-watchlist",
      audience: "hub-users",
      description:
        "Team-wide overview posted to a shared Slack channel. No per-client details (those go to individual CMs already) - just team health, CM leaderboard, and a few overall observations.",
      examplePreview: `Happy Tuesday! ☕

*Health score: 50% · ↑ 7pt vs gisteren · 7d avg building…*
🟢 20 healthy · 🟡 6 watch · 🔴 14 action

*Campaign Manager ranking*
🥇 Roel & Mike - *68%* · 🟢 13 · 🟡 3 · 🔴 3

Open Watchlist`,
    },
    {
      id: "personal_sales",
      title: "Personal Sales Summary",
      destination: "dm",
      channelLabel: "DM · per closer/setter",
      schedule: "Daily · 06:00 Europe/Amsterdam",
      previewEndpoint: "/api/slack/preview-daily-sales",
      cronEndpoint: "/api/cron/slack-personal-sales",
      audience: "closers",
      description:
        "Every closer/setter mapped to a Slack ID gets a personal morning DM with yesterday's calls + status breakdown, today's planned calls, MTD progress vs targets, and any past appointments still in pre-call status.",
      examplePreview: `Goedemorgen Anel.

*Gisteren*
• 4 calls totaal
• 2× DEAL · 1× No deal/FU · 1× No show

*Deze maand (mei)*
• 38 taken calls
• 12/30 deals

Open Targets`,
    },
    {
      id: "team_sales",
      title: "Team Sales Summary",
      destination: "channel",
      channelLabel: "Slack channel",
      channelKey: "sales",
      channelId: salesChannelId,
      schedule: "Daily · 06:00 Europe/Amsterdam",
      previewEndpoint: "/api/slack/preview-team-sales",
      cronEndpoint: "/api/cron/slack-team-sales",
      audience: "closers",
      description:
        "Team-wide sales overview posted to the sales channel. Aggregated yesterday/today/MTD numbers across all closers, plus a leaderboard sorted by deals.",
      examplePreview: `Goedemorgen sales team! ☕

*Leaderboard - deze maand*
🥇 Anel - *12 deals* · €27.4k · 32%
🥈 Jill - *9 deals* · €19.8k · 28%

Open Targets`,
    },
  ]

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("settings.notifications.slack_section", locale)}
        icon={<MessageSquare className="h-3.5 w-3.5 text-purple-500" />}
      />

      {!slackConnected && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs">
          <p className="text-yellow-500 font-medium">
            {t("settings.notifications.slack_not_connected.title", locale)}
          </p>
          <p className="text-muted-foreground mt-0.5">
            {t("settings.notifications.slack_not_connected.body_before", locale)}
            <span className="font-medium">
              {t("settings.notifications.slack_not_connected.tokens_tab", locale)}
            </span>
            {t("settings.notifications.slack_not_connected.body_middle", locale)}
            <span className="font-medium">
              {t("settings.notifications.slack_not_connected.mapping_tab", locale)}
            </span>
            {t("settings.notifications.slack_not_connected.body_after", locale)}
          </p>
        </div>
      )}

      <TestDmCard slackConnected={slackConnected} />

      <div className="space-y-3">
        {notifications.map((n) => {
          const audienceWith =
            n.audience === "closers"
              ? closers
                  .filter((c) => c.slackId)
                  .map((c) => ({ name: c.name, email: c.name, hasSlack: true }))
              : recipientsWithSlack
          const audienceMissing =
            n.audience === "closers"
              ? closers
                  .filter((c) => !c.slackId)
                  .map((c) => ({ name: c.name, email: c.name, hasSlack: false }))
              : recipientsMissing
          return (
            <NotificationCard
              key={n.id}
              def={n}
              slackConnected={slackConnected}
              enabled={enabled[n.id] ?? true}
              togglePending={!!togglePending[n.id]}
              onToggleEnabled={() => toggleEnabled(n.id as NotificationKey)}
              busy={!!busy[n.id]}
              result={results[n.id]}
              onPreview={() => runPreview(n.id, n.previewEndpoint)}
              onSendNow={() => runSendNow(n.id, n)}
              recipientsWithSlack={audienceWith}
              recipientsMissing={audienceMissing}
              locale={locale}
            />
          )
        })}
      </div>

      <CloserSlackMappingCard closers={closers} />
    </section>
  )
}

function TestDmCard({ slackConnected }: { slackConnected: boolean }) {
  const locale = useLocale()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function send() {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch("/api/slack/test-dm", { method: "POST" })
      const data = await res.json()
      setResult(data)
    } catch {
      setResult({ ok: false, message: t("settings.notifications.request_failed", locale) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AutomationCard
      icon={<Bell className="h-4 w-4" />}
      tone="muted"
      title="Connection Test"
      description="Send a 'hello' DM to your own Slack to verify the integration works end-to-end."
      status={
        <button
          type="button"
          onClick={send}
          disabled={busy || !slackConnected}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted/60 transition-colors disabled:opacity-60 shrink-0"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {busy
            ? t("settings.notifications.action.sending", locale)
            : t("settings.notifications.action.send_test_dm", locale)}
        </button>
      }
    >
      {result?.message && (
        <p className={`text-[11px] ${result.ok ? "text-emerald-500" : "text-destructive"}`}>
          {result.message}
        </p>
      )}
    </AutomationCard>
  )
}

function NotificationCard({
  def,
  slackConnected,
  enabled,
  togglePending,
  onToggleEnabled,
  busy,
  result,
  onPreview,
  onSendNow,
  recipientsWithSlack,
  recipientsMissing,
  locale,
}: {
  def: NotificationDef
  slackConnected: boolean
  enabled: boolean
  togglePending: boolean
  onToggleEnabled: () => void
  busy: boolean
  result?: { ok: boolean; message: string }
  onPreview: () => void
  onSendNow: () => void
  recipientsWithSlack: Recipient[]
  recipientsMissing: Recipient[]
  locale: Locale
}) {
  const [showExample, setShowExample] = useState(false)
  return (
    <AutomationCard
      icon={<Bell className="h-4 w-4" />}
      tone={enabled ? "purple" : "muted"}
      title={def.title}
      description={def.description}
      status={
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] uppercase tracking-wider ${enabled ? "text-emerald-500" : "text-muted-foreground/50"}`}>
            {enabled ? t("settings.notifications.schedule.on", locale) : t("settings.notifications.schedule.off", locale)}
          </span>
          <ToggleSwitch enabled={enabled} pending={togglePending} onClick={onToggleEnabled} />
        </div>
      }
    >
      <div className="space-y-3">
        <MetaGrid
          items={[
            {
              label: t("settings.notifications.metadata.schedule", locale),
              value: <span className="font-medium">{def.schedule}</span>,
            },
            {
              label: t("settings.notifications.metadata.destination", locale),
              value: def.channelKey ? (
                <ChannelIdEditor channelKey={def.channelKey} initial={def.channelId ?? ""} />
              ) : (
                <span className="font-medium font-mono">{def.channelLabel}</span>
              ),
            },
          ]}
        />

        {def.destination === "dm" && (
          <div>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/40 mb-1.5">
              <Users className="h-3 w-3" />
              {t("settings.notifications.metadata.recipients", locale)}
            </div>
            {recipientsWithSlack.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">
                {t("settings.notifications.recipients.empty", locale)}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {recipientsWithSlack.map((r) => (
                  <span
                    key={r.email}
                    className="inline-block px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-[11px]"
                  >
                    {r.name ?? r.email}
                  </span>
                ))}
                {recipientsMissing.map((r) => (
                  <span
                    key={r.email}
                    className="inline-block px-2 py-0.5 rounded bg-muted text-muted-foreground/60 text-[11px]"
                    title={t("settings.notifications.recipients.no_slack_title", locale)}
                  >
                    {r.name ?? r.email}{" "}
                    {t("settings.notifications.recipients.no_slack", locale)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground underline"
            onClick={() => setShowExample((s) => !s)}
          >
            {showExample
              ? t("settings.notifications.example.hide", locale)
              : t("settings.notifications.example.show", locale)}
          </button>
          {showExample && (
            <pre className="mt-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-[11px] whitespace-pre-wrap font-mono leading-relaxed text-foreground/90">
              {def.examplePreview}
            </pre>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPreview}
            disabled={busy || !slackConnected}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted/60 transition-colors disabled:opacity-60"
          >
            <Send className="h-3.5 w-3.5" />
            {busy
              ? t("settings.notifications.action.working", locale)
              : t("settings.notifications.action.preview_to_me", locale)}
          </button>
          <button
            type="button"
            onClick={onSendNow}
            disabled={busy || !slackConnected}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Zap className="h-3.5 w-3.5" />
            {busy
              ? t("settings.notifications.action.sending", locale)
              : t("settings.notifications.action.send_now", locale)}
          </button>
        </div>

        {result?.message && (
          <p className={`text-[11px] ${result.ok ? "text-emerald-500" : "text-destructive"}`}>
            {result.message}
          </p>
        )}
      </div>
    </AutomationCard>
  )
}

function ChannelIdEditor({
  channelKey,
  initial,
}: {
  channelKey: ChannelKey
  initial: string
}) {
  const locale = useLocale()
  const [value, setValue] = useState(initial)
  const [savedValue, setSavedValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function commit() {
    if (value.trim() === savedValue) return
    startTransition(async () => {
      try {
        await saveSlackChannelId(channelKey, value)
        setSavedValue(value.trim())
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : t("settings.notifications.save_failed", locale))
      }
    })
  }

  const dirty = value.trim() !== savedValue
  const status = pending ? "saving" : error ? "error" : dirty ? "dirty" : value ? "saved" : "empty"

  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur()
        }}
        placeholder="C0B02NG6V39"
        className="h-7 px-2 flex-1 rounded-md border border-border bg-background text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      />
      <div className="w-4 shrink-0 flex items-center justify-center">
        {status === "saving" && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
        {status === "saved" && <Check className="h-3.5 w-3.5 text-emerald-500" />}
        {status === "dirty" && (
          <span className="h-2 w-2 rounded-full bg-yellow-500" title="Unsaved" />
        )}
        {status === "error" && (
          <span
            className="h-2 w-2 rounded-full bg-red-500"
            title={error ?? "Save failed"}
          />
        )}
      </div>
    </div>
  )
}

function CloserSlackMappingCard({ closers }: { closers: Closer[] }) {
  const locale = useLocale()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [savedMap, setSavedMap] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const c of closers) if (c.slackId) m[c.name] = c.slackId
    return m
  })

  async function commit(name: string) {
    const draft = drafts[name]
    if (draft === undefined) return
    const trimmed = draft.trim()
    if ((savedMap[name] ?? "") === trimmed) return
    setSaving((s) => ({ ...s, [name]: true }))
    try {
      await updateCloserSlackId(name, trimmed)
      setSavedMap((m) => {
        const next = { ...m }
        if (trimmed) next[name] = trimmed
        else delete next[name]
        return next
      })
      setDrafts((d) => {
        const { [name]: _drop, ...rest } = d
        return rest
      })
    } catch (e) {
      console.error(e)
    } finally {
      setSaving((s) => ({ ...s, [name]: false }))
    }
  }

  return (
    <AutomationCard
      icon={<Users className="h-4 w-4" />}
      tone="muted"
      title={t("settings.notifications.closers.title", locale)}
      description="Map each closer/setter (from the targets board wie_ column, filtered to anyone with leads in the last 60 days) to a Slack user ID so they receive their personal sales DM at 06:00. Closers don't need to be Hub users."
    >
      {closers.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">
          {t("settings.notifications.closers.empty", locale)}
        </p>
      ) : (
        <div className="divide-y divide-border/40 rounded-md border border-border/40">
          {closers.map((c) => {
            const draft = drafts[c.name] ?? savedMap[c.name] ?? ""
            const trimmed = draft.trim()
            const isSaving = !!saving[c.name]
            const savedValue = savedMap[c.name] ?? ""
            const isDirty = trimmed !== savedValue
            const isSaved = !isDirty && trimmed.length > 0
            return (
              <div
                key={c.name}
                className="flex items-center gap-3 px-3 py-2"
              >
                <span className="flex-1 text-xs font-medium truncate">{c.name}</span>
                <input
                  placeholder="U01ABC234XY"
                  className="h-7 w-[180px] px-2 rounded-md border border-border bg-background text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [c.name]: e.target.value }))}
                  onBlur={() => commit(c.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      ;(e.target as HTMLInputElement).blur()
                    }
                  }}
                />
                <div className="w-4 shrink-0 flex items-center justify-center">
                  {isSaving && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                  {!isSaving && isDirty && trimmed.length > 0 && (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-yellow-500"
                      title={t("settings.notifications.closers.row.unsaved", locale)}
                    />
                  )}
                  {!isSaving && isSaved && (
                    <Check
                      className="h-3.5 w-3.5 text-emerald-500"
                      aria-label={t("settings.notifications.closers.row.saved", locale)}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </AutomationCard>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//  Top-level tab
// ────────────────────────────────────────────────────────────────────────────

type Props = {
  inboxRules: InboxAutomationRules
  slackConnected: boolean
  recipients: Recipient[]
  teamChannelId: string | null
  salesChannelId: string | null
  closers: Closer[]
  notificationConfigs: AllNotificationConfigs
}

export function AutomationsTab({
  inboxRules,
  slackConnected,
  recipients,
  teamChannelId,
  salesChannelId,
  closers,
  notificationConfigs,
}: Props) {
  return (
    <div className="space-y-10 max-w-3xl">
      <InboxAutomationsSection rules={inboxRules} />

      <div className="border-t border-border/40" />

      <NotificationsSection
        slackConnected={slackConnected}
        recipients={recipients}
        teamChannelId={teamChannelId}
        salesChannelId={salesChannelId}
        closers={closers}
        notificationConfigs={notificationConfigs}
      />
    </div>
  )
}
