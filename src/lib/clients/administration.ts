/**
 * The Monday "Administration" column (`status_16` on the current-clients
 * board) is finance's workflow ledger for what's happening with each
 * client's invoice this cycle. Roy locked the option list to seven exact
 * labels — anything else in the column is treated as legacy / unknown and
 * passed through unchanged (so a stale row never gets silently relabelled).
 *
 * The Hub both READS the column (display pill on the Billing overview) and
 * WRITES it from a few auto-sync paths — after creating a Stripe invoice,
 * when a campaign flips to On Hold, etc. — so finance doesn't have to keep
 * the Monday column in sync manually.
 */

export const ADMIN_LABELS = {
  paymentsComplete: "Payments complete",
  onHold: "On hold",
  sendInvoice: "Send invoice",
  invoiceSend: "Invoice sent",
  discussFirst: "Discuss first",
  overdue: "Overdue",
  debtCollection: "Debt collection agencies",
} as const

export type AdminLabel = (typeof ADMIN_LABELS)[keyof typeof ADMIN_LABELS]

/** The seven canonical Monday options finance picks from, in the order the
 *  popover renders them. Keep "Payments complete" last as the resting state. */
export const ADMIN_OPTIONS: AdminLabel[] = [
  ADMIN_LABELS.sendInvoice,
  ADMIN_LABELS.invoiceSend,
  ADMIN_LABELS.overdue,
  ADMIN_LABELS.discussFirst,
  ADMIN_LABELS.onHold,
  ADMIN_LABELS.debtCollection,
  ADMIN_LABELS.paymentsComplete,
]

/** Coarse visual tone — drives the pill colour in the Billing overview. */
export type AdministrationTone = "neutral" | "warn" | "danger" | "success" | "muted"

const TONE_BY_LABEL: Record<AdminLabel, AdministrationTone> = {
  [ADMIN_LABELS.paymentsComplete]: "success",
  [ADMIN_LABELS.invoiceSend]: "warn",
  [ADMIN_LABELS.sendInvoice]: "neutral",
  [ADMIN_LABELS.discussFirst]: "neutral",
  [ADMIN_LABELS.onHold]: "muted",
  [ADMIN_LABELS.overdue]: "danger",
  [ADMIN_LABELS.debtCollection]: "danger",
}

/**
 * Labels finance sets manually as a workflow flag, NOT something the
 * auto-sync should casually overwrite. Stripe's "open invoice" signal is
 * the ONE exception: it represents an objective fact ("invoice has been
 * sent") that supersedes any in-progress flag, so the auto-sync for
 * `Invoice sent` is allowed to overwrite these. Every other auto-target
 * (Overdue / Payments complete / Send invoice / Unholt) leaves them alone.
 */
const MANUAL_LABELS_LOWER: ReadonlySet<string> = new Set([
  ADMIN_LABELS.discussFirst.toLowerCase(),
  ADMIN_LABELS.debtCollection.toLowerCase(),
])

export type AdministrationView = {
  /** Display label. Equals the raw input when it matches one of the canonical
   *  options; otherwise the raw text is shown verbatim (so a brand-new Monday
   *  option doesn't get silently misrepresented). */
  label: string
  /** Coarse tone for the pill renderer — neutral / warn / danger / success / muted. */
  tone: AdministrationTone
  /** Originally-stored Monday label when it differs from `label`. Currently
   *  only populated for legacy/unknown values where we want the tooltip to
   *  show the raw Monday text. */
  originalLabel: string | null
}

/**
 * Map a Monday administration value to a Hub view object. Empty / unset →
 * a muted "—" view so the cell still has something visible. Unknown labels
 * pass through with neutral tone (no silent translation).
 */
export function viewAdministration(raw: string | null | undefined): AdministrationView {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return { label: "—", tone: "muted", originalLabel: null }

  // Case-insensitive lookup against the canonical seven so minor casing
  // mismatches from Monday (e.g. someone typed "send Invoice") still resolve.
  const match = ADMIN_OPTIONS.find((opt) => opt.toLowerCase() === trimmed.toLowerCase())
  if (match) {
    return { label: match, tone: TONE_BY_LABEL[match], originalLabel: null }
  }

  // Unknown / legacy value — render the raw text, neutral tone, surface the
  // original on the tooltip so finance can spot the inconsistency.
  return { label: trimmed, tone: "neutral", originalLabel: trimmed }
}

/**
 * Tailwind class fragment per tone. Used by the cell renderer + the inline
 * popover option swatches so the selected pill and the menu match.
 */
export function administrationToneClass(tone: AdministrationTone): string {
  switch (tone) {
    case "success":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    case "warn":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400"
    case "danger":
      return "bg-red-500/10 text-red-600 dark:text-red-400"
    case "muted":
      return "bg-muted text-muted-foreground"
    case "neutral":
    default:
      return "bg-foreground/5 text-foreground"
  }
}

/**
 * Decide whether an auto-sync should overwrite the current admin value.
 *
 * Rule (per Roy 2026-05-19):
 *   - `Invoice sent` ALWAYS overwrites — "Stripe shipped the invoice" is an
 *     objective fact that wins over any flag (incl. Discuss first / Debt
 *     collection agencies).
 *   - Any other target leaves the manual workflow flags alone (Discuss first,
 *     Debt collection agencies). Auto-managed values can transition between
 *     themselves freely (e.g. Overdue → Payments complete when paid).
 *   - Same target as current = no write (avoids churn + redundant Monday API
 *     calls).
 */
export function shouldAutoWriteAdministration(
  current: string,
  target: AdminLabel,
): boolean {
  const lower = current.trim().toLowerCase()
  if (lower === target.toLowerCase()) return false
  if (target === ADMIN_LABELS.invoiceSend) return true
  if (MANUAL_LABELS_LOWER.has(lower)) return false
  return true
}
