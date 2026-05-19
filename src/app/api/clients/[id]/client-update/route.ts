import { auth } from "@/lib/auth"
import {
  buildWeeklyUpdateDraft,
  type WeeklyUpdateChannel,
  type WeeklyUpdateDraftResult,
} from "@/lib/clients/build-weekly-update-draft"
import {
  renderFromParts,
  type EditableParts,
} from "@/lib/clients/client-update-template"
import { NextRequest, NextResponse } from "next/server"

/**
 * Client-facing weekly update draft.
 *
 * Thin HTTP wrapper around `buildWeeklyUpdateDraft` — the same composition
 * pipeline the Monday-morning cron uses to pre-generate drafts. Returns
 * editable parts + a fresh preview render + template/channel metadata so
 * the dialog can lock the right fields and badge the V1/V2 status.
 *
 * No AI call — pulls from Pedro's daily cache + the 7d KPI cache. Variation
 * across weeks comes from a seeded picker over the variant pools defined in
 * `lib/clients/client-update-template.ts`.
 */

export type ClientUpdateChannel = WeeklyUpdateChannel

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
   *   - V2 active → `rl_weekly_<voornaam>` (5-variable structured)
   *   - V2 not active → `rl_universal_<voornaam>` (single-variable fallback)
   *  The send endpoint uses this same template — dialog reads the prefix
   *  to know whether to render in V1 or V2 layout (locked headers + comma
   *  greeting + multi-line sign-off for V2). */
  whatsappTemplateName: string | null
  /** Always "hardcoded" in the new flow (derived from users.name + kind).
   *  Kept on the response shape so any existing client code that reads it
   *  doesn't crash; the dialog no longer branches on it. */
  whatsappTemplateSource: WeeklyUpdateDraftResult["whatsappTemplateSource"]
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

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params

  try {
    const built = await buildWeeklyUpdateDraft({
      userId: session.user.id,
      mondayItemId,
    })
    if (!built) return NextResponse.json({ error: "Client not found" }, { status: 404 })

    return NextResponse.json<ClientUpdateResponse>({
      parts: built.parts,
      preview: renderFromParts(built.parts),
      channel: built.channel,
      channelLabel: built.channelLabel,
      trengoContactLinked: built.trengoContactLinked,
      whatsappTemplateName: built.whatsappTemplateName,
      whatsappTemplateSource: built.whatsappTemplateSource,
      templateVersion: built.templateVersion,
      templateVersionReason: built.templateVersionReason,
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
