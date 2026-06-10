import { Suspense } from "react"
import Link from "next/link"
import type { Session } from "next-auth"
import { fetchBothBoards } from "@/lib/integrations/monday"
import type { MondayClient } from "@/lib/integrations/monday"
import { readCache } from "@/lib/cache"
import { auth } from "@/lib/auth"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { getUserLocale } from "@/lib/i18n/server"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import {
  loadUserMappingsContext,
  filterClientsByContext,
} from "@/lib/clients/filter"
import {
  mondayStatusToHub,
  mondayLabelToOnboardingPhase,
  PHASE_LABEL_KEYS,
  PHASE_TONES,
} from "@/lib/clients/status"
import {
  resolveWizardState,
  missingCriticalSteps,
  progressPercent,
  WIZARD_STEPS,
} from "@/lib/clients/onboarding"
import { fetchStoredStepsBulk } from "@/lib/clients/onboarding-state"
import { cn } from "@/lib/utils"

/**
 * Cross-client onboarding overview. The page Roy opens on a Monday
 * morning to see "every client we're onboarding and where they're
 * stuck". For each Onboarding-status client we render: name, AM/CM,
 * phase pill, progress bar, # critical items still open, days since
 * the row was created on the onboarding board.
 *
 * Sorted by descending number of missing critical items first (most
 * blocked → top), then by ascending progress percent (least progress
 * after that), so the AM's eye lands on the rows that need attention.
 */
async function OnboardingData({
  session,
  locale,
}: {
  session: Session | null
  locale: Locale
}) {
  // Pull boards from cache (same 60-min safety window as /clients). If
  // the cron has missed every tick for an hour, fall back to a live
  // fetch — same pattern the clients page uses.
  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
    60 * 60 * 1000,
  )
  const data = cached ?? (await fetchBothBoards())

  // Per-user filter (AM/CM only see their own clients, admin sees all).
  const mappingsContext =
    session?.user?.id && session.user.role
      ? await loadUserMappingsContext(session.user.id, session.user.role)
      : null
  const onboardingBoard = filterClientsByContext(data.onboarding, mappingsContext)
  const currentBoard = filterClientsByContext(data.current, mappingsContext)

  // Hub-canonical onboarding = onboarding-board membership (always)
  // OR a current-board row whose campaignStatus collapses to
  // "onboarding" (e.g. "In development" / "Kick off"). This is the
  // exact same rule the sidebar / clients page apply.
  const clients = [
    ...onboardingBoard,
    ...currentBoard.filter((c) => mondayStatusToHub(c.campaignStatus, "current") === "onboarding"),
  ]

  // Batch the stored step state in one Supabase round-trip — N+1 here
  // would be ugly with 20-30 onboarding clients each having multiple
  // wizard rows.
  const storedBulk = await fetchStoredStepsBulk(clients.map((c) => c.mondayItemId))

  // Compute per-client summary up front so the JSX is dumb table cells.
  const rows = clients.map((client) => {
    const stored = storedBulk.get(client.mondayItemId) ?? new Map()
    const states = resolveWizardState(client, stored)
    const missing = missingCriticalSteps(states)
    const percent = progressPercent(states)
    const phase = mondayLabelToOnboardingPhase(client.campaignStatus)
    // First open + not-locked step — what the AM should knock out next
    // (mirrors the wizard's own "current step" resolution).
    const nextOpen = states.find((s) => !s.done && !s.locked)
    // Days since kickoff date or, if absent, since onboarding-board entry.
    // Falls back to null when both are missing.
    const startDate = client.kickOffDate || null
    const daysSinceStart = startDate ? daysBetween(startDate, new Date()) : null
    return { client, states, missing, percent, phase, nextOpen, daysSinceStart }
  })

  // Sort: most critical-blocked first, then lowest progress, then oldest.
  rows.sort((a, b) => {
    if (a.missing.length !== b.missing.length) return b.missing.length - a.missing.length
    if (a.percent !== b.percent) return a.percent - b.percent
    return (b.daysSinceStart ?? 0) - (a.daysSinceStart ?? 0)
  })

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card px-5 py-12 text-center text-sm text-muted-foreground">
        {t("onboarding.overview.empty", locale)}
      </div>
    )
  }

  // Lock the total ONCE so the column header doesn't shift mid-page if a
  // client edits the registry between rows. Reading from the registry
  // length keeps it in sync with the runtime step list.
  const totalTasks = WIZARD_STEPS.length

  return (
    <div className="rounded-2xl border border-border/60 bg-card overflow-hidden shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)]">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium">{t("onboarding.overview.col.client", locale)}</th>
            <th className="text-left px-3 py-2.5 font-medium">{t("onboarding.overview.col.am", locale)}</th>
            <th className="text-left px-3 py-2.5 font-medium">{t("onboarding.overview.col.cm", locale)}</th>
            <th className="text-left px-3 py-2.5 font-medium">{t("onboarding.overview.col.phase", locale)}</th>
            <th className="text-left px-3 py-2.5 font-medium w-[180px]">{t("onboarding.overview.col.progress", locale)}</th>
            <th className="text-left px-3 py-2.5 font-medium">{t("onboarding.overview.col.critical", locale)}</th>
            <th className="text-left px-3 py-2.5 font-medium">{t("onboarding.overview.col.next", locale)}</th>
            <th className="text-right px-4 py-2.5 font-medium">{t("onboarding.overview.col.days", locale)}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.map(({ client, missing, percent, phase, nextOpen, daysSinceStart }) => (
            <tr key={client.mondayItemId} className="hover:bg-muted/20 transition-colors">
              <td className="px-4 py-2.5">
                <Link
                  href={`/onboarding/${client.mondayItemId}`}
                  className="font-medium hover:text-primary transition-colors"
                >
                  {client.name || client.companyName || "—"}
                </Link>
              </td>
              <td className="px-3 py-2.5 text-muted-foreground text-xs">
                {client.accountManager || <span className="text-muted-foreground/40">—</span>}
              </td>
              <td className="px-3 py-2.5 text-muted-foreground text-xs">
                {client.campaignManager || <span className="text-muted-foreground/40">—</span>}
              </td>
              <td className="px-3 py-2.5">
                {phase ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
                      PHASE_TONES[phase].pill,
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", PHASE_TONES[phase].dot)} />
                    {t(PHASE_LABEL_KEYS[phase], locale)}
                  </span>
                ) : (
                  <span className="text-muted-foreground/40 text-xs">—</span>
                )}
              </td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-muted/60 overflow-hidden min-w-[60px]">
                    <div
                      className={cn(
                        "h-full transition-[width] duration-300",
                        missing.length > 0 ? "bg-amber-500" : "bg-primary",
                      )}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                    {percent}% · {totalTasks}t
                  </span>
                </div>
              </td>
              <td className="px-3 py-2.5">
                {missing.length > 0 ? (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-500/10 text-red-700 dark:text-red-400">
                    {missing.length}
                  </span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400 text-xs">✓</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[280px] truncate" title={nextOpen ? t(nextOpen.labelKey, locale) : ""}>
                {nextOpen ? t(nextOpen.labelKey, locale) : <span className="text-muted-foreground/40">—</span>}
              </td>
              <td className="px-4 py-2.5 text-right text-xs text-muted-foreground tabular-nums">
                {daysSinceStart !== null ? `${daysSinceStart}d` : <span className="text-muted-foreground/40">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function daysBetween(yyyyMmDd: string, now: Date): number {
  const parsed = new Date(yyyyMmDd)
  if (Number.isNaN(parsed.getTime())) return 0
  const diff = now.getTime() - parsed.getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

function OnboardingLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-72 rounded-lg" />
      <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-3">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}

export default async function OnboardingOverviewPage() {
  const session = await auth()
  const locale = await getUserLocale(session?.user?.id)
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("onboarding.overview.title", locale)}
        subtitle={t("onboarding.overview.subtitle", locale)}
      />
      <Suspense fallback={<OnboardingLoading />}>
        <OnboardingData session={session} locale={locale} />
      </Suspense>
    </div>
  )
}
