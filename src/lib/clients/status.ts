/**
 * Hub-canonical client statuses. The Hub only displays four statuses, while
 * Monday holds many more (variants of "Stopt", "Subcampaigns only", "Kick off",
 * etc). Read-mapping collapses all Monday values into one of these four;
 * write-mapping picks the canonical Monday label per Hub status so we don't
 * proliferate variants when users edit from the Hub.
 */
export type ClientStatus = "onboarding" | "live" | "on_hold" | "churned"

export const STATUS_LABELS: Record<ClientStatus, string> = {
  onboarding: "Onboarding",
  live: "Live",
  on_hold: "On Hold",
  churned: "Churned",
}

/** Label for missing / unmapped status. Used everywhere the UI renders a
 *  status pill — so empty Monday statuses surface as a muted dash instead of
 *  a misleading "Onboarding" label. */
export const STATUS_LABEL_NONE = "—"

/** Look up the label for a possibly-null status without exploding the type
 *  system at call sites that previously did `STATUS_LABELS[status]`. */
export function statusLabel(status: ClientStatus | null): string {
  return status === null ? STATUS_LABEL_NONE : STATUS_LABELS[status]
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
