import { createAdminClient } from "@/lib/supabase/server"

/**
 * Resolve which WhatsApp HSM template to use when an AM sends a message.
 *
 * Hardcoded convention: every AM has TWO approved templates in Trengo:
 *   - `rl_universal_<voornaam>` - single-variable wrapper for ad-hoc /
 *     AI-drafted updates (inbox composer, per-client "Update" button)
 *   - `rl_weekly_<voornaam>`    - multi-variable structured template for
 *     the weekly Client Update (per-client "Update" button on the clients
 *     table; composed fresh on open)
 *
 * The AM's `<voornaam>` is derived from `users.name` (first token,
 * lowercased). No per-AM override is consulted - onboarding a new AM
 * means creating two Meta-approved templates in Trengo with that name,
 * not editing a Hub setting.
 *
 * Why hardcoded:
 *   - Previous implementation consulted `users.whatsapp_template_name`
 *     first, then auto-discovered via Trengo. Auto-discovery needed a
 *     channel-id from prior Trengo activity for the *client*, which
 *     failed for fresh clients and pinned the resolver to `universal_*`
 *     even for the weekly path.
 *   - Hardcoding the convention removes both dependencies. Every AM
 *     gets the right template every time; if the template doesn't
 *     exist yet, Trengo errors at send-time with a clear message.
 */

export type WaTemplateResolution = {
  /** The template_name to pass to Trengo's TEMPLATE send, or null when we
   *  can't derive a first name from `users.name`. */
  name: string | null
  /** Always "hardcoded" in the new flow. Kept as a union for the existing
   *  dialog rendering that branches on `"trengo_auto"`. */
  source: "hardcoded" | "none"
}

/**
 * Per-AM overrides for the weekly template slug. Used when an AM's
 * default `rl_weekly_<firstname>` is broken in Meta (e.g., approved
 * with the wrong body) and a versioned re-approval (`_2`, `_3`)
 * replaces it. Keyed by the lowercased first name; the override wins
 * over the convention slug.
 *
 * Keep this list short and intentional - long-term these should
 * become a column on `users` (e.g. `weekly_template_slug`) so admins
 * can manage them without a deploy. For now in-code is fast enough.
 */
const WEEKLY_TEMPLATE_OVERRIDES: Record<string, string> = {
  // Danny's original `rl_weekly_danny` had a body bug; reapproved as _2.
  danny: "rl_weekly_danny_2",
}

/**
 * Build the template slug from an AM's first name + the template kind.
 * Returns null when the first name contains anything other than ASCII
 * letters/digits (Meta slugs don't allow accents or spaces) - caller
 * should treat that as a config error on the user row.
 *
 * Per-AM overrides (e.g. Danny's `_2` version) only apply to the
 * `weekly` kind; universal stays on the convention slug.
 */
export function hardcodedTemplateName(
  amFirstName: string,
  kind: "universal" | "weekly",
): string | null {
  const first = (amFirstName ?? "").trim().toLowerCase().split(/\s+/)[0] ?? ""
  if (!first || !/^[a-z][a-z0-9]*$/.test(first)) return null
  if (kind === "weekly" && WEEKLY_TEMPLATE_OVERRIDES[first]) {
    return WEEKLY_TEMPLATE_OVERRIDES[first]
  }
  return `rl_${kind}_${first}`
}

/** Look up the AM's first name from the `users` table. Returns "" when
 *  the user row is missing or has no name set - callers translate that
 *  into a null template name + a clear error to the AM. */
async function loadAmFirstName(userId: string): Promise<string> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("users")
    .select("name")
    .eq("id", userId)
    .maybeSingle<{ name: string | null }>()
  return (data?.name ?? "").trim().split(/\s+/)[0] ?? ""
}

/** Universal HSM template (`rl_universal_<voornaam>`) - used by ad-hoc
 *  / AI-drafted outbound (inbox composer, per-client Update button). */
export async function resolveWaTemplate(args: {
  userId: string
  /** Accepted for backwards-compat with existing call sites. Unused since
   *  template resolution no longer depends on the client's prior Trengo
   *  activity. */
  mondayItemId?: string
}): Promise<WaTemplateResolution> {
  const first = await loadAmFirstName(args.userId)
  const name = hardcodedTemplateName(first, "universal")
  return { name, source: name ? "hardcoded" : "none" }
}

/** Weekly Update HSM template (`rl_weekly_<voornaam>`) - used by the
 *  per-client Client Update dialog (the "Update" button on the clients
 *  table). */
export async function resolveWeeklyUpdateTemplate(args: {
  userId: string
  /** Accepted for backwards-compat - see resolveWaTemplate. */
  mondayItemId?: string
}): Promise<WaTemplateResolution> {
  const first = await loadAmFirstName(args.userId)
  const name = hardcodedTemplateName(first, "weekly")
  return { name, source: name ? "hardcoded" : "none" }
}
