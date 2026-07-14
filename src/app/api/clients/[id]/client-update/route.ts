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
import {
  readWeeklyUpdateCache,
  writeWeeklyUpdateCache,
} from "@/lib/clients/weekly-update-cache"
import { fetchClientById } from "@/lib/integrations/monday"
import { resolveClientSendChannel } from "@/lib/clients/send-channel"
import { NextRequest, NextResponse } from "next/server"

/**
 * Client-facing weekly update draft.
 *
 * Thin HTTP wrapper around `buildWeeklyUpdateDraft`. Serves the Monday
 * cron's pre-cached snapshot (`weekly_update_cache`) when present so the
 * dialog opens instantly during the Monday bulk send; on a miss it builds
 * live (the 20-40s Meta + Stripe + Pedro + template fan-out) and lazily
 * writes the result to the cache so the next open is fast too. The weekly
 * KPI window is last week's already-completed range, so a cached snapshot
 * stays valid for the whole week.
 *
 * Returns editable parts + a fresh preview render + the resolved WhatsApp
 * template name (`rl_weekly_<voornaam>`) so the dialog can post the right
 * send payload. No AI call - pulls from Pedro's daily cache + the 7d KPI
 * cache.
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
  /** Email + phone read straight from Monday's client columns, so the
   *  dialog can render "To: <address>" for verification before send. */
  recipientEmail: string | null
  recipientPhone: string | null
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params

  try {
    // Fast path: serve the Monday cron's pre-built snapshot. It holds the
    // expensive-to-compute bits (parts + channel + template); the cheap
    // recipient/channel-label fields come from a single Monday read so the
    // "To: <address>" preview always matches what the send path resolves.
    const cached = await readWeeklyUpdateCache(mondayItemId)
    if (cached) {
      const client = await fetchClientById(mondayItemId)
      if (client) {
        const resolved = resolveClientSendChannel(client)
        return NextResponse.json<ClientUpdateResponse>({
          parts: cached.parts,
          preview: renderFromParts(cached.parts),
          channel: cached.channel,
          channelLabel: client.contactChannel ?? "",
          trengoContactLinked: resolved.ok,
          whatsappTemplateName: cached.templateName,
          // The cron resolved the slug via `hardcodedTemplateName`, so the
          // dialog should treat it as "hardcoded" too.
          whatsappTemplateSource: cached.templateName ? "hardcoded" : "none",
          recipientEmail: client.email || null,
          recipientPhone: client.phone || null,
        })
      }
      // Monday fetch failed - fall through to the live build below.
    }

    const built = await buildWeeklyUpdateDraft({
      userId: session.user.id,
      mondayItemId,
    })
    if (!built) return NextResponse.json({ error: "Client not found" }, { status: 404 })

    // Populate the cache so the next open this week is instant even if the
    // cron didn't cover this client (flipped Live mid-week, or opened before
    // Monday's run). Awaited - it's one fast upsert and the caller already
    // paid the live-build wait.
    await writeWeeklyUpdateCache({
      mondayItemId,
      parts: built.parts,
      channel: built.channel,
      templateName: built.whatsappTemplateName,
    })

    return NextResponse.json<ClientUpdateResponse>({
      parts: built.parts,
      preview: renderFromParts(built.parts),
      channel: built.channel,
      channelLabel: built.channelLabel,
      trengoContactLinked: built.trengoContactLinked,
      whatsappTemplateName: built.whatsappTemplateName,
      whatsappTemplateSource: built.whatsappTemplateSource,
      recipientEmail: built.recipientEmail,
      recipientPhone: built.recipientPhone,
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
