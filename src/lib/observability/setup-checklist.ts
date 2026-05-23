import { createAdminClient } from "@/lib/supabase/server"

/**
 * Setup checklist — drives the Settings banner + the sidebar dot for new
 * (or partially-configured) workspaces. Distinct from the runtime health
 * probe (`fetchHealthSummary`): that one flags things that broke after
 * setup (cron errors, tokens that went invalid). This one flags things
 * that were never configured in the first place — "Stripe token missing",
 * "board config not saved", "users without Monday role".
 *
 * Roy 2026-05-23: when a new account opens the Hub it isn't obvious
 * which fields/IDs need filling for everything to work. The banner makes
 * the gap actionable instead of hidden.
 */

/** Services whose tokens must be present + valid for the Hub to operate
 *  end-to-end. Fathom is optional today (the team can ingest meetings
 *  via direct backfill if Fathom isn't connected) so it's not in the
 *  required set, even though it's in api_tokens. */
const REQUIRED_TOKEN_SERVICES = ["monday", "meta", "stripe", "trengo"] as const
type RequiredService = (typeof REQUIRED_TOKEN_SERVICES)[number]

export type ChecklistItem = {
  /** Stable id — used as the Settings deeplink anchor and the React key. */
  id: string
  /** Short label rendered in the banner ("Stripe API token missing"). */
  label: string
  /** Which Settings tab to deeplink to — matches SettingsTabs tab ids. */
  tab: "tokens" | "board" | "users" | "notifications"
  /** Lower number = higher priority in the banner. Tokens come first
   *  because nothing else works without them. */
  priority: number
}

export type SetupChecklist = {
  items: ChecklistItem[]
  /** Number of items not yet complete. The sidebar dot lights when > 0. */
  incompleteCount: number
}

export const EMPTY_CHECKLIST: SetupChecklist = { items: [], incompleteCount: 0 }

const SERVICE_LABELS: Record<RequiredService, string> = {
  monday: "Monday",
  meta: "Meta",
  stripe: "Stripe",
  trengo: "Trengo",
}

/**
 * One-shot read of the things a brand-new workspace needs to fill in.
 * Three indexed queries against Supabase — cheap enough to call on every
 * admin sidebar render. Returns EMPTY_CHECKLIST on any failure so the
 * sidebar never crashes when this helper does.
 */
export async function fetchSetupChecklist(): Promise<SetupChecklist> {
  try {
    const supabase = await createAdminClient()

    const [tokensRes, boardCfgRes, usersRes, mappingsRes] = await Promise.all([
      supabase.from("api_tokens").select("service, is_valid"),
      supabase.from("settings").select("key").eq("key", "board_config").maybeSingle(),
      supabase.from("users").select("id, role"),
      supabase.from("user_column_mappings").select("user_id, monday_column_role"),
    ])

    const items: ChecklistItem[] = []

    // (1) Required API tokens — split out per service so the admin sees
    //     exactly which service is missing instead of "tokens missing".
    const tokenState = new Map<string, { is_valid: boolean | null }>()
    for (const row of tokensRes.data ?? []) {
      tokenState.set(row.service, { is_valid: row.is_valid })
    }
    for (const svc of REQUIRED_TOKEN_SERVICES) {
      const state = tokenState.get(svc)
      const missing = !state
      const invalid = state && state.is_valid === false
      if (missing) {
        items.push({
          id: `token-missing-${svc}`,
          label: `${SERVICE_LABELS[svc]} API token not yet added`,
          tab: "tokens",
          priority: 1,
        })
      } else if (invalid) {
        items.push({
          id: `token-invalid-${svc}`,
          label: `${SERVICE_LABELS[svc]} API token is invalid — reconnect`,
          tab: "tokens",
          priority: 1,
        })
      }
    }

    // (2) Board config — the JSON blob that maps Monday columns to Hub
    //     fields. Without it the per-client KPI fetches and the client
    //     list both fall back to defaults that may not match the actual
    //     boards.
    if (!boardCfgRes.data) {
      items.push({
        id: "board-config-missing",
        label: "Monday board config not saved",
        tab: "board",
        priority: 2,
      })
    }

    // (3) Users without a Monday role mapping — non-admin non-finance
    //     users need this so the per-user client filter (Watch List,
    //     All campaigns) returns the right rows. Finance is org-level
    //     and explicitly doesn't map to a Monday column.
    const mapped = new Set((mappingsRes.data ?? []).map((m) => m.user_id))
    const unmapped = (usersRes.data ?? []).filter(
      (u) => u.role !== "admin" && !mapped.has(u.id),
    )
    if (unmapped.length > 0) {
      items.push({
        id: "users-without-mapping",
        label: `${unmapped.length} user${unmapped.length === 1 ? "" : "s"} missing Monday role mapping`,
        tab: "users",
        priority: 3,
      })
    }

    items.sort((a, b) => a.priority - b.priority)
    return { items, incompleteCount: items.length }
  } catch {
    return EMPTY_CHECKLIST
  }
}
