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
import { createAdminClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

/**
 * Client-facing weekly update draft.
 *
 * Thin HTTP wrapper around `buildWeeklyUpdateDraft` - the same composition
 * pipeline the Monday-morning cron uses. Returns editable parts + a fresh
 * preview render + the resolved WhatsApp template name (hardcoded
 * `rl_weekly_<voornaam>`) so the dialog can post the right send payload.
 *
 * No AI call - pulls from Pedro's daily cache + the 7d KPI cache.
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
  /** Email + phone resolved from the client's Trengo contact, so the
   *  dialog can render "To: <address>" for verification before send. */
  recipientEmail: string | null
  recipientPhone: string | null
}

/** ISO date (YYYY-MM-DD) of the Monday of `d` (UTC). Matches the
 *  `week_of` key the Monday cron writes into `weekly_update_drafts`. */
function mondayOfUtc(d: Date): string {
  const day = d.getUTCDay() // 0 = Sunday … 6 = Saturday
  const offsetFromMonday = (day + 6) % 7 // Mon→0, Tue→1, …, Sun→6
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - offsetFromMonday)
  return monday.toISOString().slice(0, 10)
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params

  // Cache check - the Monday-morning cron pre-builds a draft for every
  // Live + Trengo-linked client and stores it in `weekly_update_drafts`.
  // Reusing that snapshot skips the Meta + Stripe + Trengo + Pedro fan-out
  // that buildWeeklyUpdateDraft does, which is the 30-40s "Update
  // klaarzetten…" hang the AM sees mid-week. The data hasn't changed -
  // the weekly KPI window is last week's already-completed range - so
  // the cron's snapshot is the right thing to show. Falls through to the
  // live build only when no pending draft exists (client wasn't a cron
  // candidate, e.g. flipped Live mid-week, or the cron hasn't run yet).
  try {
    const supabase = await createAdminClient()
    const weekOf = mondayOfUtc(new Date())
    const { data: cachedDraft } = await supabase
      .from("weekly_update_drafts")
      .select("parts, channel, template_name")
      .eq("monday_item_id", mondayItemId)
      .eq("week_of", weekOf)
      .eq("status", "pending")
      .maybeSingle<{
        parts: EditableParts | null
        channel: ClientUpdateChannel | null
        template_name: string | null
      }>()

    if (cachedDraft?.parts) {
      // Pull recipient email/phone live (cheap; shared trengoFetch cache)
      // so the "To: …" line in the dialog reflects current contact data.
      // Best-effort - null when no Trengo contact is linked or the fetch
      // fails. This is the only network call left on the hot path.
      const { fetchClientById } = await import("@/lib/integrations/monday")
      const { fetchTrengoContact } = await import("@/lib/integrations/trengo")
      const client = await fetchClientById(mondayItemId)
      const trengoContact = client?.trengoContactId
        ? await fetchTrengoContact(client.trengoContactId).catch(() => null)
        : null
      const channel: ClientUpdateChannel =
        cachedDraft.channel === "email" || cachedDraft.channel === "whatsapp"
          ? cachedDraft.channel
          : "unknown"

      return NextResponse.json<ClientUpdateResponse>({
        parts: cachedDraft.parts,
        preview: renderFromParts(cachedDraft.parts),
        channel,
        channelLabel: client?.contactChannel ?? "",
        trengoContactLinked: !!client?.trengoContactId,
        whatsappTemplateName: cachedDraft.template_name,
        // The cron resolved the slug via the same `hardcodedTemplateName`
        // helper, so the dialog's branching logic on the source field
        // should treat it as "hardcoded" too.
        whatsappTemplateSource: cachedDraft.template_name ? "hardcoded" : "none",
        recipientEmail: trengoContact?.email ?? null,
        recipientPhone: trengoContact?.phone ?? null,
      })
    }
  } catch (e) {
    // Cache lookup failure should never block the live build. Log and
    // fall through.
    console.error(
      "[client-update] weekly_update_drafts cache lookup failed:",
      e instanceof Error ? e.message : e,
    )
  }

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
