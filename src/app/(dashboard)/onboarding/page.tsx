import { Suspense } from "react"
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
  type OnboardingPhase,
} from "@/lib/clients/status"
import {
  OnboardingPhaseGroups,
  type PhaseGroup,
  type PhaseRow,
} from "./_components/onboarding-phase-groups"

/**
 * Cross-client onboarding overview, phase-grouped. Roy 2026-06-11:
 * replaced the flat table because a single sorted list of 20+ clients
 * across 6 phases didn't scan well. Now grouped into watchlist-style
 * banners that follow the actual onboarding flow:
 *
 *   1. Kick-off ingepland
 *   2. Wachten op klant
 *   3. Campagne opzetten
 *   4. Wachten op feedback
 *   5. LAUNCH / klaar voor CM
 *   6. On hold
 *   7. Kassabureau (collapsed by default)
 *
 * Clients without a resolved Monday phase fall into bucket 1 because
 * "no status set" usually means kick-off planning is the next step.
 *
 * Columns are intentionally minimal: name, AM, CM, days. The phase pill
 * is now redundant with the section header, and the progress/critical/
 * next-task columns added noise — those signals live inside the wizard
 * detail view where the AM actually does the work.
 */
async function OnboardingData({
  session,
  locale,
}: {
  session: Session | null
  locale: Locale
}) {
  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
    60 * 60 * 1000,
  )
  const data = cached ?? (await fetchBothBoards())

  const mappingsContext =
    session?.user?.id && session.user.role
      ? await loadUserMappingsContext(session.user.id, session.user.role)
      : null
  const onboardingBoard = filterClientsByContext(data.onboarding, mappingsContext)
  const currentBoard = filterClientsByContext(data.current, mappingsContext)

  // Hub-canonical onboarding = onboarding-board membership OR a current-
  // board row whose status collapses to "onboarding". Same rule as the
  // sidebar / clients page apply.
  const clients = [
    ...onboardingBoard,
    ...currentBoard.filter((c) => mondayStatusToHub(c.campaignStatus, "current") === "onboarding"),
  ]

  // Bucketize by phase. Null phase (no resolvable label) → kickoff_
  // scheduled bucket so it stays visible at the top instead of being
  // dropped.
  const buckets = new Map<OnboardingPhase, PhaseRow[]>()
  for (const client of clients) {
    const phase = mondayLabelToOnboardingPhase(client.campaignStatus) ?? "kickoff_scheduled"
    const list = buckets.get(phase) ?? []
    const startDate = client.kickOffDate || null
    list.push({
      mondayItemId: client.mondayItemId,
      displayName: client.name || client.companyName || "-",
      accountManager: client.accountManager || "",
      campaignManager: client.campaignManager || "",
      daysSinceStart: startDate ? daysBetween(startDate, new Date()) : null,
    })
    buckets.set(phase, list)
  }

  // Sort within each bucket by days-in-onboarding descending (oldest first
  // → catches stuck clients). Then assemble in canonical phase order.
  for (const list of buckets.values()) {
    list.sort((a, b) => (b.daysSinceStart ?? 0) - (a.daysSinceStart ?? 0))
  }

  const phaseOrder: OnboardingPhase[] = [
    "kickoff_scheduled",
    "waiting_on_client",
    "create_campaign",
    "waiting_for_feedback",
    "launch",
    "on_hold",
    "debt_collection",
  ]
  const groups: PhaseGroup[] = phaseOrder.map((phase) => ({
    phase,
    rows: buckets.get(phase) ?? [],
  }))

  return <OnboardingPhaseGroups groups={groups} locale={locale} />
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
      {[...Array(4)].map((_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-2xl" />
      ))}
    </div>
  )
}

export default async function OnboardingOverviewPage() {
  const session = await auth()
  const locale = await getUserLocale(session?.user?.id)
  return (
    <div className="space-y-4">
      <PageHeader title={t("onboarding.overview.title", locale)} />
      <Suspense fallback={<OnboardingLoading />}>
        <OnboardingData session={session} locale={locale} />
      </Suspense>
    </div>
  )
}
