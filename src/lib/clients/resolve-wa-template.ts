import { createAdminClient } from "@/lib/supabase/server"
import { fetchWaTemplates } from "@/lib/integrations/trengo"

/**
 * Resolve which WhatsApp HSM template to use when an AM sends a client update.
 *
 * Two-step lookup:
 *   1. PREFER `users.whatsapp_template_name` — admin-configured per AM in
 *      Settings → Users. Always wins when set. This is the path the inbox
 *      composer already uses for free-text → template wrapping.
 *   2. FALLBACK to Trengo auto-discovery — when the Hub field is empty we go
 *      to the workspace's actual template pool. Templates already exist there
 *      for every AM (Roy's standing setup), so requiring duplicate Hub config
 *      is busywork. We pick by matching the convention `rl_universal_<voornaam>`
 *      against the user's first name, falling back to any `rl_universal_*`
 *      that matches at all.
 *
 * The channel-id comes from the inbox anchor (latest Trengo inbox_event for
 * the client). Without a channel we can't fetch templates because Trengo
 * requires it server-side, so the discovery step is skipped silently — caller
 * sees `name: null` and surfaces a "configure first" hint.
 */

export type WaTemplateResolution = {
  /** The template_name to pass to Trengo's TEMPLATE send, or null when none
   *  could be resolved. Caller treats null as "block send + show hint". */
  name: string | null
  /** Where the name came from — useful for the dialog to render a small
   *  "(uit Trengo)" tag when we auto-discovered it. */
  source: "user_config" | "trengo_auto" | "none"
}

/**
 * Find the Trengo channel-id associated with this client by walking the most
 * recent Trengo-sourced inbox_event. Returns null when the client has no
 * prior Trengo conversation in Hub history.
 */
async function findChannelIdForClient(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  mondayItemId: string,
): Promise<number | null> {
  const { data: clientRow } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", mondayItemId)
    .maybeSingle()
  if (!clientRow?.id) return null
  const { data } = await supabase
    .from("inbox_events")
    .select("trengo_channel_id")
    .eq("client_id", clientRow.id)
    .eq("source", "trengo")
    .not("trengo_channel_id", "is", null)
    .order("created_at_src", { ascending: false })
    .limit(1)
    .maybeSingle<{ trengo_channel_id: number | null }>()
  return data?.trengo_channel_id ?? null
}

/**
 * Pick a template for the AM from the workspace template list. Preference
 * order:
 *   1. Template slug/name `{prefix}<firstname>` (case-insensitive,
 *      handles compound names by checking start-of-suffix).
 *   2. Any template with slug starting `{prefix}`.
 *   3. null when neither matches.
 */
function pickByConvention(
  templates: Array<{ name?: string; slug?: string }>,
  userFirstName: string,
  prefix: string,
): string | null {
  const first = userFirstName.toLowerCase().split(/\s+/)[0] ?? ""
  const lowerPrefix = prefix.toLowerCase()
  const candidates = templates
    .map((t) => ({
      name: (t.slug || t.name || "").toLowerCase(),
      raw: t.slug || t.name || "",
    }))
    .filter((t) => t.name.startsWith(lowerPrefix))

  if (first) {
    const exact = candidates.find((t) => t.name === `${lowerPrefix}${first}`)
    if (exact) return exact.raw
    // Compound-name guard: "rl_universal_roy_v2" still matches "roy".
    const prefixMatch = candidates.find((t) => t.name.startsWith(`${lowerPrefix}${first}`))
    if (prefixMatch) return prefixMatch.raw
  }
  return candidates[0]?.raw ?? null
}

export type ResolveWaTemplateArgs = {
  userId: string
  mondayItemId: string
  /** Template-slug prefix to search for in Trengo. Defaults to `"rl_universal_"`
   *  for backwards-compat with the inbox composer + Client Update V1.
   *  Weekly Update V2 passes `"rl_weekly_update_"`. */
  prefix?: string
  /** When true (default), prefer the AM's `users.whatsapp_template_name`
   *  override before falling back to Trengo auto-discovery. The Weekly
   *  Update path passes `false` because that DB column is universal-only
   *  — there's no per-AM override slot for the weekly template (yet). */
  useUserConfig?: boolean
}

export async function resolveWaTemplate(args: ResolveWaTemplateArgs): Promise<WaTemplateResolution> {
  const prefix = args.prefix ?? "rl_universal_"
  const useUserConfig = args.useUserConfig ?? true
  const supabase = await createAdminClient()

  // Step 1 — user-configured field wins (only for the default universal flow).
  const { data: user } = await supabase
    .from("users")
    .select("name, whatsapp_template_name")
    .eq("id", args.userId)
    .maybeSingle<{ name: string | null; whatsapp_template_name: string | null }>()

  if (useUserConfig) {
    const configured = user?.whatsapp_template_name?.trim()
    if (configured) {
      return { name: configured, source: "user_config" }
    }
  }

  // Step 2 — Trengo auto-discovery, needs a channel-id we can target.
  const channelId = await findChannelIdForClient(supabase, args.mondayItemId)
  if (!channelId) {
    return { name: null, source: "none" }
  }

  try {
    // `fetchWaTemplates` returns ACCEPTED templates for the channel — exactly
    // the set we're allowed to send. We feed `slug` into `pickByConvention`
    // because Trengo's `template_name` field on the send payload IS the slug
    // (the same string admins paste into `users.whatsapp_template_name`).
    const templates = await fetchWaTemplates(channelId)
    const picked = pickByConvention(
      templates.map((t) => ({ slug: t.slug, name: t.title })),
      user?.name ?? "",
      prefix,
    )
    if (!picked) return { name: null, source: "none" }
    return { name: picked, source: "trengo_auto" }
  } catch (e) {
    console.error(
      "[resolve-wa-template] Trengo fetch failed:",
      e instanceof Error ? e.message : e,
    )
    return { name: null, source: "none" }
  }
}

/**
 * Resolve the per-AM weekly-update HSM template (`rl_weekly_update_<voornaam>`)
 * for the logged-in user. Skips the `users.whatsapp_template_name` override
 * because that field is wired to the universal template only — weekly update
 * relies on auto-discovery from Trengo against the convention slug.
 *
 * Returns `{ name: null }` when no matching template exists yet (Meta hasn't
 * approved one for this AM). Callers should fall back to V1 (single-var
 * universal + sanitise) so a send never hard-fails on missing approval.
 */
export function resolveWeeklyUpdateTemplate(args: {
  userId: string
  mondayItemId: string
}): Promise<WaTemplateResolution> {
  return resolveWaTemplate({
    ...args,
    prefix: "rl_weekly_update_",
    useUserConfig: false,
  })
}
