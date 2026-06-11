"use client"

import { useState } from "react"
import Link from "next/link"
import {
  ChevronDown,
  ChevronRight,
  CalendarClock,
  UserCheck,
  Wrench,
  MessageCircle,
  Rocket,
  Pause,
  AlertOctagon,
} from "lucide-react"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import type { DictionaryKey } from "@/lib/i18n/dictionary"
import { type OnboardingPhase, PHASE_LABEL_KEYS } from "@/lib/clients/status"

export type PhaseRow = {
  mondayItemId: string
  displayName: string
  accountManager: string
  campaignManager: string
  daysSinceStart: number | null
}

export type PhaseGroup = {
  /** null = clients whose Monday campaignStatus didn't resolve to one of
   *  the canonical phases (fresh arrivals or off-template labels). We
   *  fold those into the kickoff_scheduled group at the top because
   *  that's the natural default before anyone sets a status. */
  phase: OnboardingPhase
  rows: PhaseRow[]
}

type Props = {
  groups: PhaseGroup[]
  locale: Locale
}

/**
 * Phase-grouped onboarding overview. Roy 2026-06-11: replaces the flat
 * table because a flat list of 20+ clients across 6 different phases is
 * harder to scan than 6 collapsible blocks in the same order as the
 * actual flow (kick-off → wachten op klant → campagne opzetten →
 * wachten op feedback → launch → kassabureau).
 *
 * Visual idiom mirrors the Watchlist banners: rounded-2xl card with a
 * tinted header button, count pill, body with a 4px left stripe in the
 * phase's tone. Kassabureau (debt_collection) defaults to collapsed —
 * those rows shouldn't be top-of-page noise. Everything else open.
 */
export function OnboardingPhaseGroups({ groups, locale }: Props) {
  if (groups.every((g) => g.rows.length === 0)) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card px-5 py-12 text-center text-sm text-muted-foreground">
        {t("onboarding.overview.empty", locale)}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {groups.map((g) =>
        g.rows.length === 0 ? null : (
          <PhaseSection
            key={g.phase}
            phase={g.phase}
            rows={g.rows}
            defaultOpen={PHASE_VISUAL_CONFIG[g.phase].defaultOpen}
            locale={locale}
          />
        ),
      )}
    </div>
  )
}

function PhaseSection({
  phase,
  rows,
  defaultOpen,
  locale,
}: {
  phase: OnboardingPhase
  rows: PhaseRow[]
  defaultOpen: boolean
  locale: Locale
}) {
  const [open, setOpen] = useState(defaultOpen)
  const cfg = PHASE_VISUAL_CONFIG[phase]
  const Icon = cfg.icon
  return (
    <div className="rounded-2xl border border-border/40 overflow-hidden bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2.5 w-full px-4 py-3 ${cfg.headerBg} ${cfg.headerHover} transition-colors`}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
        )}
        <Icon className={`h-4 w-4 ${cfg.iconColor}`} />
        <span className="text-sm font-medium">{t(cfg.labelKey, locale)}</span>
        <span className="text-xs text-muted-foreground/60 tabular-nums">{rows.length}</span>
      </button>

      {open && (
        <div className={`overflow-hidden border-l-4 ${cfg.stripeBorder}`}>
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">
                  {t("onboarding.overview.col.client", locale)}
                </th>
                <th className="text-left px-3 py-2 font-medium">
                  {t("onboarding.overview.col.am", locale)}
                </th>
                <th className="text-left px-3 py-2 font-medium">
                  {t("onboarding.overview.col.cm", locale)}
                </th>
                <th className="text-right px-4 py-2 font-medium w-[80px]">
                  {t("onboarding.overview.col.days", locale)}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((r) => (
                <tr key={r.mondayItemId} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/onboarding/${r.mondayItemId}`}
                      className="font-medium hover:text-primary transition-colors"
                    >
                      {r.displayName}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs">
                    {r.accountManager || (
                      <span className="text-muted-foreground/40">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs">
                    {r.campaignManager || (
                      <span className="text-muted-foreground/40">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground tabular-nums">
                    {r.daysSinceStart !== null ? (
                      `${r.daysSinceStart}d`
                    ) : (
                      <span className="text-muted-foreground/40">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Phase visual config ───────────────────────────────────────────────
// Mirrors watchlist's CATEGORY_CONFIG idiom (header tint + continuous
// left stripe). Tones roughly match the Monday status column colors so
// the Hub doesn't diverge visually from where AMs already work today.

type PhaseVisualConfig = {
  icon: typeof CalendarClock
  iconColor: string
  headerBg: string
  headerHover: string
  stripeBorder: string
  labelKey: DictionaryKey
  defaultOpen: boolean
}

const PHASE_VISUAL_CONFIG: Record<OnboardingPhase, PhaseVisualConfig> = {
  kickoff_scheduled: {
    icon: CalendarClock,
    iconColor: "text-zinc-500",
    headerBg: "bg-zinc-500/10",
    headerHover: "hover:bg-zinc-500/15",
    stripeBorder: "border-zinc-500/60",
    labelKey: PHASE_LABEL_KEYS.kickoff_scheduled,
    defaultOpen: true,
  },
  waiting_on_client: {
    icon: UserCheck,
    iconColor: "text-violet-500",
    headerBg: "bg-violet-500/10",
    headerHover: "hover:bg-violet-500/15",
    stripeBorder: "border-violet-500/60",
    labelKey: PHASE_LABEL_KEYS.waiting_on_client,
    defaultOpen: true,
  },
  create_campaign: {
    icon: Wrench,
    iconColor: "text-orange-500",
    headerBg: "bg-orange-500/10",
    headerHover: "hover:bg-orange-500/15",
    stripeBorder: "border-orange-500/60",
    labelKey: PHASE_LABEL_KEYS.create_campaign,
    defaultOpen: true,
  },
  waiting_for_feedback: {
    icon: MessageCircle,
    iconColor: "text-blue-500",
    headerBg: "bg-blue-500/10",
    headerHover: "hover:bg-blue-500/15",
    stripeBorder: "border-blue-500/60",
    labelKey: PHASE_LABEL_KEYS.waiting_for_feedback,
    defaultOpen: true,
  },
  launch: {
    icon: Rocket,
    iconColor: "text-emerald-500",
    headerBg: "bg-emerald-500/10",
    headerHover: "hover:bg-emerald-500/15",
    stripeBorder: "border-emerald-500/60",
    labelKey: PHASE_LABEL_KEYS.launch,
    defaultOpen: true,
  },
  on_hold: {
    icon: Pause,
    iconColor: "text-amber-500",
    headerBg: "bg-amber-500/10",
    headerHover: "hover:bg-amber-500/15",
    stripeBorder: "border-amber-500/60",
    labelKey: PHASE_LABEL_KEYS.on_hold,
    defaultOpen: true,
  },
  debt_collection: {
    icon: AlertOctagon,
    iconColor: "text-red-600",
    headerBg: "bg-red-500/10",
    headerHover: "hover:bg-red-500/15",
    stripeBorder: "border-red-500/60",
    labelKey: PHASE_LABEL_KEYS.debt_collection,
    defaultOpen: false,
  },
}
