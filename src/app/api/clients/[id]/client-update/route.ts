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
 * pipeline the Monday-morning cron uses. Returns editable parts + a fresh
 * preview render + the resolved WhatsApp template name (hardcoded
 * `rl_weekly_<voornaam>`) so the dialog can post the right send payload.
 *
 * No AI call — pulls from Pedro's daily cache + the 7d KPI cache.
 */

export type ClientUpdateChannel = WeeklyUpdateChannel

export type ClientUpdateResponse = {
  /** Editable variable content. The Trengo template body provides the
   *  surrounding skeleton ("Hey ...", section headers, "Groetjes,"). */
  parts: EditableParts
  /** Pre-rendered preview of the initial draft. The dialog re-renders live
   *  on every edit via `renderFromParts(parts)`. */
  preview: string
  channel: ClientUpdateChannel
  channelLabel: string
  trengoContactLinked: boolean
  /** Hardcoded `rl_weekly_<voornaam>` for the WhatsApp path; null for email
   *  channels or when users.name can't be parsed into an ASCII first name. */
  whatsappTemplateName: string | null
  whatsappTemplateSource: WeeklyUpdateDraftResult["whatsappTemplateSource"]
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
