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

/** Order shown in dropdowns and filters. */
export const STATUS_OPTIONS: ClientStatus[] = ["onboarding", "live", "on_hold", "churned"]

export const STATUS_TONES: Record<ClientStatus, { dot: string; pill: string }> = {
  onboarding: { dot: "bg-amber-500", pill: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  live: { dot: "bg-emerald-500", pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  on_hold: { dot: "bg-zinc-400", pill: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" },
  churned: { dot: "bg-red-500", pill: "bg-red-500/10 text-red-600 dark:text-red-400" },
}

/**
 * Map a Monday `campaign_status` cell value to a Hub status. Clients on the
 * Onboarding board are always "onboarding" regardless of column value, since
 * the board itself signals the lifecycle phase. Anything in the "Stopt" group
 * (multiple variants) and "Debt collecting agency" collapse to churned.
 */
export function mondayStatusToHub(
  mondayLabel: string | null | undefined,
  boardType: "onboarding" | "current",
): ClientStatus {
  if (boardType === "onboarding") return "onboarding"

  const normalized = (mondayLabel ?? "").trim().toLowerCase()
  if (!normalized) return "onboarding"

  if (normalized === "live" || normalized === "subcampaigns only") return "live"
  if (normalized === "on hold") return "on_hold"
  if (normalized === "in development" || normalized === "kick off") return "onboarding"
  if (normalized.startsWith("stopt") || normalized === "debt collecting agency") return "churned"

  return "onboarding"
}

const HUB_TO_MONDAY_LABEL: Record<ClientStatus, string> = {
  live: "Live",
  on_hold: "On hold",
  onboarding: "In development",
  churned: "Stopt",
}

/**
 * Canonical Monday label written back when the user picks a Hub status from
 * an edit dropdown. Existing Monday variants (e.g. "Stopt - geen budget",
 * "Subcampaigns only") get overwritten with the canonical version on edit.
 */
export function hubStatusToMondayLabel(status: ClientStatus): string {
  return HUB_TO_MONDAY_LABEL[status]
}
