import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchClientById } from "@/lib/integrations/monday"
import { parsePedroBody } from "@/lib/pedro/insights/types"
import { readCache } from "@/lib/cache"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import {
  composeInitialParts,
  renderFromParts,
  type EditableParts,
} from "@/lib/clients/client-update-template"
import { resolveWaTemplate, resolveWeeklyUpdateTemplate } from "@/lib/clients/resolve-wa-template"
import { NextRequest, NextResponse } from "next/server"

/**
 * Client-facing weekly update draft.
 *
 * Returns a split { parts, locked } so the dialog can lock the template
 * skeleton (KPI bullets, headers, computed trend sentence) while letting the
 * AM edit the narrative parts (greeting, intro, conclusion, actions, closer).
 *
 * No AI call — pulls from Pedro's daily cache + the 7d KPI cache. Variation
 * across weeks comes from a seeded picker over the variant pools defined in
 * `lib/clients/client-update-template.ts`.
 */

export type ClientUpdateChannel = "whatsapp" | "email" | "unknown"

export type ClientUpdateResponse = {
  /** Every field the AM sees is editable — the Trengo template wrapper
   *  ("Hey ..." prefix + "Groetjes ..." suffix) lives in Trengo, not here. */
  parts: EditableParts
  /** Pre-rendered preview of the initial draft. The dialog re-renders live
   *  on every edit via `renderFromParts(parts)`. */
  preview: string
  channel: ClientUpdateChannel
  channelLabel: string
  trengoContactLinked: boolean
  /** The resolved WhatsApp HSM template name for the active path:
   *   - V2 active → `rl_weekly_update_<voornaam>` (5-variable structured)
   *   - V2 not active → `rl_universal_<voornaam>` (single-variable fallback)
   *  The send endpoint uses this same template — dialog reads the prefix
   *  to know whether to render in V1 or V2 layout (locked headers + comma
   *  greeting + multi-line sign-off for V2). */
  whatsappTemplateName: string | null
  /** Where the resolved template came from. The dialog renders a small
   *  "(uit Trengo)" hint on `trengo_auto` so the AM knows it was discovered
   *  rather than configured by an admin. */
  whatsappTemplateSource: "user_config" | "trengo_auto" | "none"
  /** 1 = V1 universal single-var path (legacy + fallback when V2 template
   *  not approved). 2 = V2 multi-var weekly-update path. Dialog uses this
   *  to lock headers ("📊 Cijfers deze week:", "✅ Wat we deze week gaan
   *  doen:") and reformat the sign-off to match the approved template body.
   *  Null when channel is email (no template involved). */
  templateVersion: 1 | 2 | null
  /** Human-readable explanation of why we fell back to V1 (or have no
   *  template at all). Null when V2 is active OR channel is email. The
   *  dialog renders this as a small italic note so the AM can self-diagnose
   *  ("env flag uit", "geen prior Trengo gesprek", "approved template
   *  ontbreekt") without checking server logs. */
  templateVersionReason: string | null
}

function detectChannel(label: string): ClientUpdateChannel {
  const l = label.toLowerCase()
  if (l.includes("whatsapp") || l.includes("wa") || l.includes("app")) return "whatsapp"
  if (l.includes("email") || l.includes("mail")) return "email"
  return "unknown"
}

async function loadKpi(mondayItemId: string): Promise<KpiSummary | null> {
  const cache = await readCache<Record<string, KpiSummary>>("kpi_summaries")
  return cache?.[mondayItemId] ?? null
}

async function loadPedroBody(mondayItemId: string) {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("pedro_insights")
    .select("body")
    .eq("monday_item_id", mondayItemId)
    .eq("insight_type", "client_pedro")
    .maybeSingle()
  return parsePedroBody(data?.body ?? null)
}

/** Resolve the AM's display name from the users table — used as fallback for
 *  email sign-off when no WhatsApp template slug is available. */
async function loadHubUserName(userId: string): Promise<{ name: string | null } | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("users")
    .select("name")
    .eq("id", userId)
    .maybeSingle<{ name: string | null }>()
  return data
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params

  try {
    const client = await fetchClientById(mondayItemId)
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 })

    const channel = detectChannel(client.contactChannel)
    const isEmail = channel === "email"

    // Template resolution: prefer V2 weekly-update when feature flag on AND
    // Meta has approved `rl_weekly_update_<voornaam>` for this AM. Falls
    // back to V1 universal otherwise so the dialog always has SOMETHING to
    // render. Email path skips entirely (no HSM template needed).
    const v2Enabled = !isEmail && process.env.WEEKLY_UPDATE_TEMPLATE_V2 === "true"

    const [kpi, pedro, v2Template, hubUser] = await Promise.all([
      loadKpi(mondayItemId),
      loadPedroBody(mondayItemId),
      v2Enabled
        ? resolveWeeklyUpdateTemplate({ userId: session.user.id, mondayItemId })
        : Promise.resolve({ name: null as string | null, source: "none" as const }),
      loadHubUserName(session.user.id),
    ])

    const useV2 = !!v2Template.name
    const v1Template =
      isEmail || useV2
        ? { name: null as string | null, source: "none" as const }
        : await resolveWaTemplate({ userId: session.user.id, mondayItemId })

    const waTemplate = useV2 ? v2Template : v1Template

    // Why V1 (or nothing)? Walk the preconditions in order so the AM sees
    // the FIRST thing they need to fix. Null when V2 is active OR email.
    let templateVersionReason: string | null = null
    if (!isEmail && !useV2) {
      if (!v2Enabled) {
        templateVersionReason =
          "WEEKLY_UPDATE_TEMPLATE_V2 env-flag staat uit in Vercel (zet 'm op true en redeploy)."
      } else if (!v2Template.name) {
        const amSlug = hubUser?.name?.split(/\s+/)[0]?.toLowerCase() ?? "<voornaam>"
        templateVersionReason = v1Template.name
          ? `rl_weekly_update_${amSlug} niet gevonden in Trengo (status APPROVED?). V1-fallback actief.`
          : `Geen WhatsApp template gevonden — verifieer dat rl_weekly_update_${amSlug} approved is én dat deze klant minimaal 1 eerder Trengo-gesprek heeft (resolver heeft channel_id nodig).`
      }
    }

    // AM first name: derive from whichever template slug won, stripping the
    // prefix. Falls back to the user record's display name when no template
    // is resolved (e.g. cold-start, missing approval, email channel).
    const amFirstName =
      (waTemplate.name
        ?.replace(/^rl_(weekly_update|universal)_/i, "")
        .trim() ||
        hubUser?.name?.split(/\s+/)[0] ||
        "Roel").toString()

    const composed = composeInitialParts({
      firstName: client.firstName,
      clientId: client.mondayItemId,
      clientName: client.companyName || client.name,
      amFirstName,
      channel,
      kpi,
      pedro,
    })

    return NextResponse.json<ClientUpdateResponse>({
      parts: composed.parts,
      preview: renderFromParts(composed.parts),
      channel,
      channelLabel: client.contactChannel,
      trengoContactLinked: !!client.trengoContactId,
      whatsappTemplateName: waTemplate.name,
      whatsappTemplateSource: waTemplate.source,
      templateVersion: isEmail ? null : useV2 ? 2 : 1,
      templateVersionReason,
    })
  } catch (e) {
    console.error(
      "[client-update] template render failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build update" },
      { status: 500 },
    )
  }
}
