"use client"

import { CheckCircle2, Circle, Rocket } from "lucide-react"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import {
  mondayLabelToOnboardingPhase,
  PHASE_LABEL_KEYS,
  PHASE_TONES,
  type OnboardingPhase,
} from "@/lib/clients/status"
import type { MondayClient } from "@/lib/integrations/monday"

type Props = { client: MondayClient }

/**
 * Per-client onboarding checklist — surfaces the standard "what needs to be
 * in place before this client goes live" list from knowledge/process.md as
 * concrete green/grey checks. Renders only for clients on the onboarding
 * board, so live clients don't see a stale onboarding card.
 *
 * Each item is data-driven: filled fields on the Monday item = done. The
 * checklist is read-only here — admins/AMs change the underlying fields in
 * the Settings tab or the Monday board, and the checks flip automatically.
 */
export function OnboardingChecklist({ client }: Props) {
  const locale = useLocale()
  if (client.boardType !== "onboarding") return null

  const phase = mondayLabelToOnboardingPhase(client.campaignStatus)
  const hasKickoffDate = Boolean(client.kickOffDate)
  const hasAccountManager = Boolean(client.accountManager)
  const hasCampaignManager = Boolean(client.campaignManager)
  const hasStripe = Boolean(client.stripeCustomerId)
  const hasMeta = Boolean(client.metaAdAccountId)
  const hasTrengo = Boolean(client.trengoContactId)
  const hasClientBoard = Boolean(client.clientBoardId)
  const hasDrive = Boolean(client.googleDriveId)

  // Phase ordering — derived from PHASE_OPTIONS in status.ts but laid out
  // chronologically here to drive the "are we past step X" checks for items
  // that don't have a direct boolean field (e.g. content received, ads built).
  const phaseRank: Record<OnboardingPhase, number> = {
    kickoff_scheduled: 1,
    waiting_on_client: 2,
    create_campaign: 3,
    waiting_for_feedback: 4,
    launch: 5,
    on_hold: -1,
    debt_collection: -1,
  }
  const rank = phase ? phaseRank[phase] : 0
  const isLaunched = phase === "launch"
  const isPastKickoff = rank >= 2
  const isPastBuild = rank >= 4

  const items: Array<{ done: boolean; labelKey: Parameters<typeof t>[0] }> = [
    { done: hasAccountManager && hasCampaignManager, labelKey: "client.onboarding.checklist.team_assigned" },
    { done: hasStripe, labelKey: "client.onboarding.checklist.stripe_linked" },
    { done: hasKickoffDate || isPastKickoff, labelKey: "client.onboarding.checklist.kickoff_scheduled" },
    { done: hasDrive, labelKey: "client.onboarding.checklist.drive_created" },
    { done: hasMeta, labelKey: "client.onboarding.checklist.meta_linked" },
    { done: hasClientBoard, labelKey: "client.onboarding.checklist.lead_board_created" },
    { done: hasTrengo, labelKey: "client.onboarding.checklist.trengo_linked" },
    { done: isPastBuild, labelKey: "client.onboarding.checklist.creatives_approved" },
    { done: isLaunched, labelKey: "client.onboarding.checklist.live" },
  ]

  const completed = items.filter((i) => i.done).length
  const total = items.length
  const percent = Math.round((completed / total) * 100)

  return (
    <div className="rounded-2xl border border-border/60 bg-card px-5 py-4 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)]">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">
            {t("client.onboarding.checklist.title", locale)}
          </h3>
          {phase && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
                PHASE_TONES[phase].pill,
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", PHASE_TONES[phase].dot)} />
              {t(PHASE_LABEL_KEYS[phase], locale)}
            </span>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {completed}/{total} · {percent}%
        </span>
      </div>

      <div className="h-1 rounded-full bg-muted/60 overflow-hidden mb-3">
        <div
          className="h-full bg-primary transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2 text-xs">
            {item.done ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
            )}
            <span className={cn(item.done ? "text-foreground" : "text-muted-foreground")}>
              {t(item.labelKey, locale)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
