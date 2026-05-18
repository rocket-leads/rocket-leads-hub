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
 *   1. Template slug/name `rl_universal_<firstname>` (case-insensitive,
 *      handles compound names by checking start-of-suffix).
 *   2. Any template with slug starting `rl_universal_`.
 *   3. null when neither matches.
 */
function pickByConvention(
  templates: Array<{ name?: string; slug?: string }>,
  userFirstName: string,
): string | null {
  const first = userFirstName.toLowerCase().split(/\s+/)[0] ?? ""
  const candidates = templates
    .map((t) => ({
      name: (t.slug || t.name || "").toLowerCase(),
      raw: t.slug || t.name || "",
    }))
    .filter((t) => t.name.startsWith("rl_universal_"))

  if (first) {
    const exact = candidates.find((t) => t.name === `rl_universal_${first}`)
    if (exact) return exact.raw
    // Compound-name guard: "rl_universal_roy_v2" still matches "roy".
    const prefix = candidates.find((t) => t.name.startsWith(`rl_universal_${first}`))
    if (prefix) return prefix.raw
  }
  return candidates[0]?.raw ?? null
}

export async function resolveWaTemplate(args: {
  userId: string
  mondayItemId: string
}): Promise<WaTemplateResolution> {
  const supabase = await createAdminClient()

  // Step 1 — user-configured field wins.
  const { data: user } = await supabase
    .from("users")
    .select("name, whatsapp_template_name")
    .eq("id", args.userId)
    .maybeSingle<{ name: string | null; whatsapp_template_name: string | null }>()

  const configured = user?.whatsapp_template_name?.trim()
  if (configured) {
    return { name: configured, source: "user_config" }
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
