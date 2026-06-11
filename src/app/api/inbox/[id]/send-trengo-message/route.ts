import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchConversations, fetchMessages } from "@/lib/integrations/trengo"
import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"
import { hardcodedTemplateName } from "@/lib/clients/resolve-wa-template"
import { NextRequest, NextResponse } from "next/server"

/**
 * Smart-inbox send: post the AM's edited draft as a reply on the right
 * Trengo ticket - and mark the originating Hub task as done with an audit
 * note pointing at the outbound message.
 *
 * Channel handling:
 *  - draft_channel === "trengo_email"  → post to most recent email ticket.
 *  - draft_channel === "trengo_whatsapp" → only allowed if a 24-hour session
 *    window is open (last *contact-authored* message ≤24h old). Inside the
 *    window we can send free text. Outside it we'd need a pre-approved
 *    Trengo template - that's slice 3 of this work; we 501 with a helpful
 *    pointer for now.
 *  - Anything else falls back to email behaviour for safety.
 *
 * Posts via the user's *personal* Trengo token so the message lands as them
 * in Trengo, not as the system bot. Same replies-as-self pattern as
 * /api/inbox/[id]/reply.
 */

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: taskId } = await params

  let body: { message?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const trimmed = body.message?.trim() ?? ""
  if (!trimmed) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  const { data: task } = await supabase
    .from("inbox_events")
    .select("id, client_id, assignee_id, status, source_ref, body")
    .eq("id", taskId)
    .maybeSingle<{
      id: string
      client_id: string | null
      assignee_id: string | null
      status: string
      source_ref: Record<string, unknown> | null
      body: string | null
    }>()

  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })
  if (task.status !== "open" && task.status !== "in_progress") {
    return NextResponse.json({ error: `Task is ${task.status}; cannot send` }, { status: 409 })
  }
  if (!task.client_id) {
    return NextResponse.json({ error: "Task has no client linked" }, { status: 400 })
  }

  const draftChannel = (task.source_ref as Record<string, unknown> | null)?.draft_channel
  const wantWhatsApp = draftChannel === "trengo_whatsapp"

  const { data: client } = await supabase
    .from("clients")
    .select("name, trengo_contact_ids")
    .eq("monday_item_id", task.client_id)
    .maybeSingle<{ name: string; trengo_contact_ids: string[] | null }>()
  if (!client) {
    return NextResponse.json({ error: "Client not found in Hub" }, { status: 404 })
  }
  const trengoContactId = client.trengo_contact_ids?.[0] ?? null
  if (!trengoContactId) {
    return NextResponse.json(
      { error: "Client has no Trengo contact linked. Send manually via Trengo." },
      { status: 400 },
    )
  }

  const userToken = await getUserPlatformToken(session.user.id, "trengo")
  if (!userToken) {
    return NextResponse.json(
      { error: "Connect your Trengo account first (Settings → My Account)." },
      { status: 409 },
    )
  }

  let conversations
  try {
    conversations = await fetchConversations(trengoContactId)
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to look up Trengo conversations: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  // Branch: pick the right ticket per intended channel + verify we're allowed
  // to send free text on it.
  let targetTicket: { id: number; channel: { type: string | null } | null } | null = null
  let outboundChannelLabel: "trengo_email" | "trengo_whatsapp" = "trengo_email"

  if (wantWhatsApp) {
    const waTicket = conversations.find((c) => isWhatsappChannel(c.channel?.type ?? null))
    if (!waTicket) {
      return NextResponse.json(
        {
          error:
            "Geen recente WhatsApp-conversatie met deze contact gevonden. Stuur 'm even handmatig vanuit Trengo, of registreer eerst een WhatsApp-template.",
        },
        { status: 400 },
      )
    }

    // 24h session window: free text only allowed when the latest *contact-
    // authored* message is ≤24h old. Outside the window we have to send via
    // a Meta-approved template registered in Trengo. The convention is
    // `rl_universal_<voornaam>` for ad-hoc outbound - derived hardcoded
    // from the assignee's `users.name` (no per-AM override consulted).
    const windowOpen = await isSessionWindowOpen(waTicket.id)
    if (!windowOpen) {
      const assigneeId = task.assignee_id
      if (!assigneeId) {
        return NextResponse.json(
          { error: "Task has no assignee - kan geen template-naam opzoeken." },
          { status: 400 },
        )
      }
      const { data: assignee } = await supabase
        .from("users")
        .select("name")
        .eq("id", assigneeId)
        .maybeSingle<{ name: string | null }>()
      const templateName = hardcodedTemplateName(assignee?.name ?? "", "universal")
      if (!templateName) {
        return NextResponse.json(
          {
            error: `Buiten 24u session window en kan geen template-naam afleiden uit ${assignee?.name ?? "de assignee"}. Verifieer dat users.name een geldige voornaam bevat.`,
          },
          { status: 501 },
        )
      }

      // Send via Trengo's HSM template endpoint. We post into the existing
      // ticket so the conversation stays threaded. Trengo accepts a `template`
      // payload on the message endpoint that wraps the WA template send.
      let templateOutboundId: string
      try {
        const res = await fetch(
          `https://app.trengo.com/api/v2/tickets/${waTicket.id}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${userToken}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              type: "TEMPLATE",
              template_name: templateName,
              language: "nl",
              params: [trimmed],
              internal_note: false,
            }),
          },
        )
        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          return NextResponse.json(
            {
              error: `Trengo template send failed (${res.status}): ${errText.slice(0, 200)}. Verifieer dat template '${templateName}' goedgekeurd is.`,
            },
            { status: 502 },
          )
        }
        const json = (await res.json()) as { id?: number | string; data?: { id?: number | string } }
        templateOutboundId = String(json.id ?? json.data?.id ?? "")
      } catch (e) {
        return NextResponse.json(
          { error: `Trengo template send failed: ${e instanceof Error ? e.message : String(e)}` },
          { status: 502 },
        )
      }

      // Audit + done in one shot - the regular post path is skipped because
      // we already wrote the message above.
      const sentAt = new Date().toISOString()
      const auditNote = `\n\n- Verstuurd via Trengo WhatsApp template '${templateName}' (ticket ${waTicket.id}, message ${templateOutboundId}) op ${sentAt.slice(0, 10)}.`
      const sourceRef = (task.source_ref ?? {}) as Record<string, unknown>
      await supabase
        .from("inbox_events")
        .update({
          status: "done",
          completed_at: sentAt,
          body: (task.body ?? "") + auditNote,
          source_ref: {
            ...sourceRef,
            sent_via: "trengo_whatsapp_template",
            sent_template_name: templateName,
            sent_ticket_id: waTicket.id,
            sent_message_id: templateOutboundId,
            sent_at: sentAt,
          },
        })
        .eq("id", taskId)
        .in("status", ["open", "in_progress"])

      return NextResponse.json({
        ok: true,
        ticketId: waTicket.id,
        messageId: templateOutboundId,
        channel: "trengo_whatsapp_template",
        templateName,
      })
    }

    targetTicket = waTicket
    outboundChannelLabel = "trengo_whatsapp"
  } else {
    const emailTicket = conversations.find((c) => isEmailChannel(c.channel?.type ?? null))
    if (!emailTicket) {
      return NextResponse.json(
        {
          error:
            "No recent email conversation found for this contact in Trengo. Send manually via Trengo for now.",
        },
        { status: 400 },
      )
    }
    targetTicket = emailTicket
    outboundChannelLabel = "trengo_email"
  }

  let outboundId: string
  try {
    const res = await fetch(`https://app.trengo.com/api/v2/tickets/${targetTicket.id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ message: trimmed, internal_note: false }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      return NextResponse.json(
        { error: `Trengo send failed (${res.status}): ${errText.slice(0, 200)}` },
        { status: 502 },
      )
    }
    const json = (await res.json()) as { id?: number | string; data?: { id?: number | string } }
    outboundId = String(json.id ?? json.data?.id ?? "")
  } catch (e) {
    return NextResponse.json(
      { error: `Trengo send failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  const sentAt = new Date().toISOString()
  const channelHuman = outboundChannelLabel === "trengo_whatsapp" ? "WhatsApp" : "email"
  const auditNote = `\n\n- Verstuurd via Trengo ${channelHuman} (ticket ${targetTicket.id}, message ${outboundId}) op ${sentAt.slice(0, 10)}.`
  const sourceRef = (task.source_ref ?? {}) as Record<string, unknown>
  await supabase
    .from("inbox_events")
    .update({
      status: "done",
      completed_at: sentAt,
      body: (task.body ?? "") + auditNote,
      source_ref: {
        ...sourceRef,
        sent_via: outboundChannelLabel,
        sent_ticket_id: targetTicket.id,
        sent_message_id: outboundId,
        sent_at: sentAt,
      },
    })
    .eq("id", taskId)
    .in("status", ["open", "in_progress"])

  return NextResponse.json({
    ok: true,
    ticketId: targetTicket.id,
    messageId: outboundId,
    channel: outboundChannelLabel,
  })
}

/**
 * The WhatsApp 24h session window is anchored on the latest message *from
 * the contact* (not from us). If the contact hasn't sent us anything in the
 * last 24h, Meta requires a pre-approved template for any outbound text.
 *
 * We ask Trengo for the messages of the most recent ticket and look at the
 * newest "Contact"-authored entry. Failure modes (no messages, fetch error)
 * default to "closed" - safer to ask the AM to handle manually than to push
 * an outbound that Meta will then reject silently.
 */
async function isSessionWindowOpen(ticketId: number): Promise<boolean> {
  try {
    const messages = await fetchMessages(ticketId)
    const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS
    for (const m of messages) {
      if (m.author_type !== "Contact") continue
      const t = new Date(m.created_at).getTime()
      if (Number.isFinite(t) && t >= cutoff) return true
    }
    return false
  } catch {
    return false
  }
}

/** Trengo channel types vary in casing/spelling between accounts; treat any
 *  string mentioning "email" or "mail" as email-suitable. */
function isEmailChannel(type: string | null): boolean {
  if (!type) return false
  const lower = type.toLowerCase()
  return lower.includes("email") || lower.includes("mail")
}

/** Anything that mentions WhatsApp / WA Business in the channel type. */
function isWhatsappChannel(type: string | null): boolean {
  if (!type) return false
  const lower = type.toLowerCase()
  return lower.includes("whats") || lower.includes("wa_") || lower === "wa" || lower.includes("wa-")
}
