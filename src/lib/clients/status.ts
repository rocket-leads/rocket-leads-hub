import type { DictionaryKey } from "@/lib/i18n/dictionary"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"

/**
 * Hub-canonical client statuses. The Hub only displays four statuses, while
 * Monday holds many more (variants of "Stopt", "Subcampaigns only", "Kick off",
 * etc). Read-mapping collapses all Monday values into one of these four;
 * write-mapping picks the canonical Monday label per Hub status so we don't
 * proliferate variants when users edit from the Hub.
 */
export type ClientStatus = "onboarding" | "live" | "on_hold" | "churned"

/**
 * Canonical EN labels — kept stable because they're written back to Monday
 * (via `hubStatusToMondayLabel`) and used as comparison keys throughout the
 * codebase. UI-facing surfaces should use STATUS_LABEL_KEYS + t() instead so
 * Dutch users see Nederlands.
 */
export const STATUS_LABELS: Record<ClientStatus, string> = {
  onboarding: "Onboarding",
  live: "Live",
  on_hold: "On Hold",
  churned: "Churned",
}

/** Dictionary keys for translation. Use with `t(STATUS_LABEL_KEYS[s], locale)`
 *  wherever a status is shown to the user — filter dropdowns, pills, headers.
 *  The canonical EN strings above stay reserved for Monday writes + analytics. */
export const STATUS_LABEL_KEYS: Record<ClientStatus, DictionaryKey> = {
  onboarding: "client.status.onboarding",
  live: "client.status.live",
  on_hold: "client.status.on_hold",
  churned: "client.status.churned",
}

/** Label for missing / unmapped status. Used everywhere the UI renders a
 *  status pill — so empty Monday statuses surface as a muted dash instead of
 *  a misleading "Onboarding" label. */
export const STATUS_LABEL_NONE = "—"

/** Look up the canonical EN label for a possibly-null status. Used for
 *  sorting, server-side identifiers, and analytics where the locale-independent
 *  value matters. UI surfaces should call `statusLabelI18n` instead. */
export function statusLabel(status: ClientStatus | null): string {
  return status === null ? STATUS_LABEL_NONE : STATUS_LABELS[status]
}

/** Locale-aware status label — use this for everything the user reads.
 *  Null falls back to the muted dash; the four canonical statuses route
 *  through the dictionary. */
export function statusLabelI18n(status: ClientStatus | null, locale: Locale): string {
  return status === null ? STATUS_LABEL_NONE : t(STATUS_LABEL_KEYS[status], locale)
}

/** Locale-aware phase label — display variant for onboarding phase. */
export function phaseLabelI18n(phase: OnboardingPhase, locale: Locale): string {
  return t(PHASE_LABEL_KEYS[phase], locale)
}

/** Order shown in dropdowns and filters. */
export const STATUS_OPTIONS: ClientStatus[] = ["onboarding", "live", "on_hold", "churned"]

// Colour palette mirrors Monday's column-option styling so the Hub and the
// CRM read identically at-a-glance: grey Onboarding · green Live · yellow
// On Hold · red Churned. Used for both the dot and the pill background.
export const STATUS_TONES: Record<ClientStatus, { dot: string; pill: string }> = {
  onboarding: { dot: "bg-zinc-400", pill: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" },
  live: { dot: "bg-emerald-500", pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  on_hold: { dot: "bg-yellow-500", pill: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" },
  churned: { dot: "bg-red-500", pill: "bg-red-500/10 text-red-600 dark:text-red-400" },
}

/** Tone for the null/unmapped status. Muted so it reads as "no value" and
 *  doesn't compete with the four real statuses. */
export const STATUS_TONE_NONE = {
  dot: "bg-muted-foreground/30",
  pill: "bg-muted/40 text-muted-foreground",
} as const

/** Tone lookup for nullable status — returns the muted tone when null. */
export function statusTone(status: ClientStatus | null): { dot: string; pill: string } {
  return status === null ? STATUS_TONE_NONE : STATUS_TONES[status]
}

/**
 * Map a Monday `campaign_status` cell value to a Hub status.
 *
 * Read mapping aligned with the actual Monday status options observed in the
 * board (counts as of 2026-05-05, n=761):
 *   - Live / Subcampaigns only                    → live
 *   - On hold / PAUSED (long term)                → on_hold
 *   - In development / Kickoff scheduled / Kick off → onboarding
 *   - Stopped 1st month / Stopped 2nd month+ /
 *     Stopped (subcampaign) / Stopt* /
 *     Debt collection agency / Guarantee not met  → churned
 *
 * Both literal "Churned" and "Onboarding" are also accepted, so when Monday's
 * status column is renamed to canonical labels the mapping keeps working
 * without a code change.
 *
 * Empty Monday status → null (renders as "—" in the UI rather than a
 * misleading Onboarding badge). Truly unknown labels also collapse to null
 * so we never silently misclassify a new Monday option.
 *
 * Boards: clients on the Onboarding board are always "onboarding" regardless
 * of column value — the board itself signals the lifecycle phase.
 */
export function mondayStatusToHub(
  mondayLabel: string | null | undefined,
  boardType: "onboarding" | "current",
): ClientStatus | null {
  if (boardType === "onboarding") return "onboarding"

  const normalized = (mondayLabel ?? "").trim().toLowerCase()
  if (!normalized) return null

  // Live family
  if (normalized === "live" || normalized === "subcampaigns only") return "live"

  // On-hold family
  if (normalized === "on hold" || normalized.startsWith("paused")) return "on_hold"

  // Onboarding family
  if (
    normalized === "onboarding" ||
    normalized === "in development" ||
    normalized === "kick off" ||
    normalized === "kickoff scheduled"
  ) {
    return "onboarding"
  }

  // Churned family — covers all "Stopped …" / "Stopt …" variants plus
  // collection/guarantee outcomes which are functionally a churn.
  if (
    normalized === "churned" ||
    normalized.startsWith("stopt") ||
    normalized.startsWith("stopped") ||
    normalized === "debt collection agency" ||
    normalized === "debt collecting agency" ||
    normalized === "guarantee not met"
  ) {
    return "churned"
  }

  // Unknown/new Monday label — surface as null so a missing mapping doesn't
  // hide behind a phantom "Onboarding" badge. Add the label to the ladders
  // above when it shows up in real data.
  return null
}

const HUB_TO_MONDAY_LABEL: Record<ClientStatus, string> = {
  live: "Live",
  on_hold: "On hold",
  onboarding: "In development",
  churned: "Churned",
}

/**
 * Canonical Monday label written back when the user picks a Hub status from
 * an edit dropdown. Existing Monday variants (e.g. "Stopt - geen budget",
 * "Subcampaigns only") get overwritten with the canonical version on edit.
 */
export function hubStatusToMondayLabel(status: ClientStatus): string {
  return HUB_TO_MONDAY_LABEL[status]
}

// ─── Onboarding phases ────────────────────────────────────────────────────
// The onboarding board's `campaign_status` column doubles as the phase tracker
// (replacing the old groups-as-phase model). All phases collapse to the
// canonical "onboarding" Hub status — phases are an onboarding-tab-only detail.

export type OnboardingPhase =
  | "kickoff_scheduled"
  | "waiting_on_client"
  | "create_campaign"
  | "waiting_for_feedback"
  | "launch"
  | "on_hold"
  | "debt_collection"

/** Canonical EN labels — must match the Monday status column options EXACTLY,
 *  because these strings are written back to Monday on edit. Renaming an option
 *  in Monday means renaming it here too. UI surfaces should use
 *  PHASE_LABEL_KEYS + t() to display the locale-aware version. */
export const PHASE_LABELS: Record<OnboardingPhase, string> = {
  kickoff_scheduled: "Kickoff scheduled",
  waiting_on_client: "Waiting on client",
  create_campaign: "Create campaign",
  waiting_for_feedback: "Waiting for feedback",
  launch: "LAUNCH 🚀",
  on_hold: "On hold",
  debt_collection: "Debt collection agency",
}

/** Dictionary keys for translation. Use with `t(PHASE_LABEL_KEYS[p], locale)`
 *  in dropdowns, pills and any other display surface. Monday writes still go
 *  through PHASE_LABELS above (canonical EN). */
export const PHASE_LABEL_KEYS: Record<OnboardingPhase, DictionaryKey> = {
  kickoff_scheduled: "client.phase.kickoff_scheduled",
  waiting_on_client: "client.phase.waiting_on_client",
  create_campaign: "client.phase.create_campaign",
  waiting_for_feedback: "client.phase.waiting_for_feedback",
  launch: "client.phase.launch",
  on_hold: "client.phase.on_hold",
  debt_collection: "client.phase.debt_collection",
}

/** Display order — mirrors the chronological flow from kick-off to launch,
 *  with the off-track states (on hold, debt collection) at the bottom. */
export const PHASE_OPTIONS: OnboardingPhase[] = [
  "kickoff_scheduled",
  "waiting_on_client",
  "create_campaign",
  "waiting_for_feedback",
  "launch",
  "on_hold",
  "debt_collection",
]

// Tones tuned to roughly match the colours used on the Monday status column
// itself (grey · purple · orange · blue · green · amber · brown-red).
export const PHASE_TONES: Record<OnboardingPhase, { dot: string; pill: string }> = {
  kickoff_scheduled:    { dot: "bg-zinc-400",    pill: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300" },
  waiting_on_client:    { dot: "bg-violet-400",  pill: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  create_campaign:      { dot: "bg-orange-400",  pill: "bg-orange-500/10 text-orange-700 dark:text-orange-400" },
  waiting_for_feedback: { dot: "bg-blue-400",    pill: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  launch:               { dot: "bg-emerald-500", pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  on_hold:              { dot: "bg-amber-400",   pill: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  debt_collection:      { dot: "bg-red-700",     pill: "bg-red-700/10 text-red-700 dark:text-red-400" },
}

/**
 * Map a Monday `campaign_status` value (from the onboarding board) to one of
 * the canonical phases. Returns null when empty or when the label doesn't fit
 * any known bucket — e.g. legacy "In development" values left over from before
 * the phase rename. Matching is normalized so trailing emoji and minor casing
 * differences ("Kick off scheduled" vs "Kickoff scheduled") still resolve.
 */
export function mondayLabelToOnboardingPhase(
  label: string | null | undefined,
): OnboardingPhase | null {
  const n = (label ?? "").trim().toLowerCase()
  if (!n) return null

  if (n === "kickoff scheduled" || n === "kick off scheduled" || n === "kick-off scheduled") return "kickoff_scheduled"
  if (n === "waiting on client") return "waiting_on_client"
  if (n === "create campaign") return "create_campaign"
  if (n === "waiting for feedback" || n === "waiting on feedback") return "waiting_for_feedback"
  if (n.startsWith("launch")) return "launch"
  if (n === "on hold") return "on_hold"
  if (n.startsWith("debt collection")) return "debt_collection"
  return null
}
