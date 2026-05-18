import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchClientById } from "@/lib/integrations/monday"
import { fetchConversations } from "@/lib/integrations/trengo"
import { replyToInboxEvent, NeedsConnectError } from "@/lib/inbox/reply"
import { resolveWaTemplate } from "@/lib/clients/resolve-wa-template"
import { NextRequest, NextResponse } from "next/server"

/**
 * Send a Hub-composed client update via Trengo.
 *
 * Hooks into the existing reply pipeline: find the latest inbox_event for the
 * client (which carries the Trengo channel + ticket + thread context), then
 * call `replyToInboxEvent` so the message lands in the right conversation AND
 * gets mirrored into Hub history the same way regular replies do.
 *
 * Send shape: WhatsApp HSM TEMPLATE, not free-text. The AM's personal
 * `whatsapp_template_name` (e.g. `rl_universal_roy`) is the Meta-approved
 * wrapper, and the rendered weekly update goes into `{{1}}`. This works
 * inside AND outside the 24h conversation window — Meta requires templates
 * for any outbound outside the window, and templates are also safe inside.
 *
 * Requires the AM to have connected their personal Trengo token at /account —
 * we send as them, not as a generic system bot, so the client sees the AM's
 * name in WhatsApp / on the email "From" line.
 *
 * Failure modes (all surface as JSON errors so the composer can render them):
 *   - No Trengo contact linked on the Monday item → 400, "no_trengo_contact"
 *   - AM has no WhatsApp template registered → 400, "no_wa_template"
 *   - No active conversation in the last 90 days → 400, "no_active_conversation"
 *   - User hasn't connected Trengo → 401, "needs_connect"
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const body = (await req.json().catch(() => ({}))) as { message?: string }
  const message = (body.message ?? "").trim()
  if (!message) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 })
  }

  try {
    const client = await fetchClientById(mondayItemId)
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 })

    if (!client.trengoContactId) {
      return NextResponse.json(
        { error: "no_trengo_contact", message: "This client has no Trengo contact linked." },
        { status: 400 },
      )
    }

    // The send shape is a Meta-approved HSM TEMPLATE, not free text. The
    // `resolveWaTemplate` helper prefers `users.whatsapp_template_name` when
    // set, falls back to auto-discovering the template from Trengo (the
    // workspace already has `rl_universal_<am>` slugs for both AMs).
    // Templates work in BOTH directions of the 24h conversation window, so
    // this path is always safe.
    const waTemplate = await resolveWaTemplate({
      userId: session.user.id,
      mondayItemId,
    })
    if (!waTemplate.name) {
      return NextResponse.json(
        {
          error: "no_wa_template",
          message:
            "Geen WhatsApp template gevonden voor deze gebruiker. Verifieer dat `rl_universal_<voornaam>` in Trengo bestaat en goedgekeurd is, of stel `whatsapp_template_name` in via Settings → Users.",
        },
        { status: 400 },
      )
    }
    const templateName = waTemplate.name

    // Strategy: look for an existing Trengo-sourced inbox_event we can reuse
    // as the threading anchor. The reply pipeline propagates source_thread +
    // trengo_channel_id from the anchor, so the template send lands in the same
    // ticket the AM was previously chatting in.
    const supabase = await createAdminClient()
    const { data: clientRow } = await supabase
      .from("clients")
      .select("id")
      .eq("monday_item_id", mondayItemId)
      .maybeSingle()
    if (!clientRow?.id) {
      return NextResponse.json(
        { error: "client_not_synced", message: "Open the client page once to sync, then retry." },
        { status: 400 },
      )
    }

    const { data: anchorRows } = await supabase
      .from("inbox_events")
      .select("id, created_at_src")
      .eq("client_id", clientRow.id)
      .eq("source", "trengo")
      .order("created_at_src", { ascending: false })
      .limit(1)
    let anchorId = anchorRows?.[0]?.id as string | undefined

    if (!anchorId) {
      // Fallback: probe Trengo directly for the latest open ticket. If we
      // find one, we don't have an inbox_event to anchor through — surface a
      // clear "start a conversation first" error rather than auto-creating
      // a ticket (which would need WhatsApp template plumbing).
      const conversations = await fetchConversations(client.trengoContactId).catch(() => [])
      if (conversations.length === 0) {
        return NextResponse.json(
          {
            error: "no_active_conversation",
            message:
              "Geen actief gesprek met deze klant gevonden in Trengo. Start eerst een gesprek (bv. via een WhatsApp template) en probeer opnieuw.",
          },
          { status: 400 },
        )
      }
      // We have a Trengo ticket but no Hub-side anchor — webhook hasn't
      // backfilled yet. Same UX: ask the AM to open the inbox first so the
      // event gets ingested, then retry.
      return NextResponse.json(
        {
          error: "no_inbox_anchor",
          message:
            "De Hub heeft dit Trengo-gesprek nog niet binnengehaald. Open de Inbox tab van deze klant één keer en probeer opnieuw.",
        },
        { status: 400 },
      )
    }

    const result = await replyToInboxEvent(session.user.id, anchorId, "", {
      internalNote: false,
      template: {
        name: templateName,
        language: "nl",
        params: [message],
      },
    })

    // Audit + freshness signal. The log row backs future history views; the
    // mirrored `last_client_update_at` on `clients` keeps the All Clients
    // list query cheap (no aggregate, no extra join). Both writes are
    // best-effort: a Supabase outage shouldn't undo the WhatsApp send.
    const sentAt = new Date().toISOString()
    const previewSnippet = message.length > 240 ? message.slice(0, 237) + "…" : message
    try {
      await Promise.all([
        supabase.from("client_updates").insert({
          client_id: clientRow.id,
          sent_at: sentAt,
          sent_by_user_id: session.user.id,
          message_preview: previewSnippet,
          template_name: templateName,
          trengo_message_id: result.outboundMsgId,
        }),
        supabase
          .from("clients")
          .update({ last_client_update_at: sentAt })
          .eq("id", clientRow.id),
      ])
    } catch (e) {
      console.error(
        "[send-client-update] audit write failed (send itself succeeded):",
        e instanceof Error ? e.message : e,
      )
    }

    return NextResponse.json({
      ok: true,
      source: result.source,
      outboundMsgId: result.outboundMsgId,
      inboxEventId: result.inboxEventId,
      sentVia: "trengo_whatsapp_template",
      templateName,
      templateSource: waTemplate.source,
      sentAt,
    })
  } catch (e) {
    if (e instanceof NeedsConnectError) {
      return NextResponse.json(
        {
          error: "needs_connect",
          platform: e.platform,
          message: `Connect your ${e.platform} account first via /account.`,
        },
        { status: 401 },
      )
    }
    console.error(
      "[send-client-update] failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Send failed" },
      { status: 500 },
    )
  }
}
