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
import { resolveWaTemplate } from "@/lib/clients/resolve-wa-template"
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
  /** The current AM's registered WhatsApp HSM template name (e.g.
   *  `rl_universal_roy`). Resolved via `resolveWaTemplate`: prefers
   *  `users.whatsapp_template_name` when set, falls back to auto-discovering
   *  the AM's template from Trengo by matching `rl_universal_<firstname>`.
   *  The send endpoint posts the rendered update as `{{1}}` of this template
   *  so it works inside AND outside the 24h WhatsApp session window. */
  whatsappTemplateName: string | null
  /** Where the resolved template came from. The dialog renders a small
   *  "(uit Trengo)" hint on `trengo_auto` so the AM knows it was discovered
   *  rather than configured by an admin. */
  whatsappTemplateSource: "user_config" | "trengo_auto" | "none"
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

    const [kpi, pedro, waTemplate] = await Promise.all([
      loadKpi(mondayItemId),
      loadPedroBody(mondayItemId),
      resolveWaTemplate({ userId: session.user.id, mondayItemId }),
    ])

    const composed = composeInitialParts({
      firstName: client.firstName,
      clientId: client.mondayItemId,
      kpi,
      pedro,
    })

    return NextResponse.json<ClientUpdateResponse>({
      parts: composed.parts,
      preview: renderFromParts(composed.parts),
      channel: detectChannel(client.contactChannel),
      channelLabel: client.contactChannel,
      trengoContactLinked: !!client.trengoContactId,
      whatsappTemplateName: waTemplate.name,
      whatsappTemplateSource: waTemplate.source,
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
