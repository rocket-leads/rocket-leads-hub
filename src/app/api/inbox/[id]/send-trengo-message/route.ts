import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import {
  findAmEmailChannel,
  findAmWaChannel,
  sendEmailToAddressAsUser,
} from "@/lib/integrations/trengo"
import { fetchClientById } from "@/lib/integrations/monday"
import {
  sendTrengoTemplateToPhoneAsUser,
  NeedsConnectError,
} from "@/lib/inbox/reply"
import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"
import { hardcodedTemplateName } from "@/lib/clients/resolve-wa-template"
import { resolveClientSendChannel } from "@/lib/clients/send-channel"
import { NextRequest, NextResponse } from "next/server"

/**
 * Smart-inbox send: post the AM's edited draft as a message to the
 * client - and mark the originating Hub task as done with an audit
 * note pointing at the outbound message.
 *
 * 2026-06-12 rewrite: routes via Monday's `phone` + `email` columns
 * instead of `client.trengo_contact_ids` + ticket lookup. The old path
 * 404'd when Trengo lost track of a contact between channels and
 * failed silently when no recent ticket existed - both showed up in
 * Roy's 2026-06-12 weekly-update error screenshots.
 *
 * Channel handling:
 *  - draft_channel === "trengo_whatsapp" or Monday preferred=WhatsApp:
 *    send the AM's edited message as an HSM TEMPLATE parameter via
 *    `rl_universal_<voornaam>`. Skips the old 24h session-window check
 *    entirely - templates work inside AND outside the window, and we
 *    no longer need an existing ticket to send into.
 *  - draft_channel === "trengo_email" or Monday preferred=Email:
 *    bootstrap a fresh email ticket via `findOrCreateTrengoEmailContact`
 *    + `createEmailMessageForContact`. Each automation send opens its
 *    own email thread - cleaner than threading into stale tickets.
 *
 * Posts via the assignee's personal Trengo token so the message lands
 * as them in Trengo, not as the system bot.
 */

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

  // `task.client_id` is the Hub clients.id UUID OR the Monday item id
  // depending on which automation seeded the row. Look up both ways to
  // survive both shapes. We need the Monday item id to fetch phone +
  // email from Monday.
  const { data: clientRow } = await supabase
    .from("clients")
    .select("monday_item_id, name")
    .or(`id.eq.${task.client_id},monday_item_id.eq.${task.client_id}`)
    .maybeSingle<{ monday_item_id: string; name: string }>()
  if (!clientRow?.monday_item_id) {
    return NextResponse.json(
      { error: "Client not found in Hub" },
      { status: 404 },
    )
  }

  const mondayClient = await fetchClientById(clientRow.monday_item_id)
  if (!mondayClient) {
    return NextResponse.json(
      { error: "Client not found in Monday" },
      { status: 404 },
    )
  }

  // Draft channel hint from the automation. Falls back to Monday's
  // preferred channel resolution when the task wasn't seeded by an
  // automation (ad-hoc inbox compose).
  const draftChannel = (task.source_ref as Record<string, unknown> | null)?.draft_channel
  const draftWantsWhatsApp = draftChannel === "trengo_whatsapp"
  const draftWantsEmail = draftChannel === "trengo_email"

  const resolved = resolveClientSendChannel(mondayClient)
  let sendKind: "whatsapp" | "email"
  if (draftWantsWhatsApp) sendKind = "whatsapp"
  else if (draftWantsEmail) sendKind = "email"
  else {
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.message }, { status: 400 })
    }
    sendKind = resolved.channel.kind
  }

  // Recipient values - prefer the resolved channel's normalised value
  // when available, fall back to the raw Monday column when the draft
  // channel forced an override (e.g. draft says WhatsApp but Monday's
  // preferred channel says Email).
  let recipientPhone = ""
  let recipientEmail = ""
  if (sendKind === "whatsapp") {
    recipientPhone =
      resolved.ok && resolved.channel.kind === "whatsapp"
        ? resolved.channel.phone
        : mondayClient.phone.replace(/[^\d+]/g, "")
    if (!recipientPhone) {
      return NextResponse.json(
        {
          error:
            "Geen telefoonnummer ingevuld op de Monday klantkaart. Vul de WhatsApp-kolom in en probeer opnieuw.",
        },
        { status: 400 },
      )
    }
  } else {
    recipientEmail =
      resolved.ok && resolved.channel.kind === "email"
        ? resolved.channel.email
        : mondayClient.email.trim().toLowerCase()
    if (!recipientEmail) {
      return NextResponse.json(
        {
          error:
            "Geen email-adres ingevuld op de Monday klantkaart. Vul de email-kolom in en probeer opnieuw.",
        },
        { status: 400 },
      )
    }
  }

  // Who sends? Assignee owns the task and the customer-facing context;
  // fall back to the logged-in user when the task has no assignee
  // (rare, but possible for auto-created drafts).
  const senderUserId = task.assignee_id ?? session.user.id
  const userToken = await getUserPlatformToken(senderUserId, "trengo")
  if (!userToken) {
    return NextResponse.json(
      {
        error:
          "De sender heeft Trengo nog niet verbonden in /account. Laat 'm Trengo daar koppelen en probeer opnieuw.",
      },
      { status: 409 },
    )
  }

  let outboundId: string
  let ticketId: string | null = null
  let templateName: string | null = null
  let outboundChannelLabel: "trengo_email" | "trengo_whatsapp_template"

  if (sendKind === "whatsapp") {
    // Free text WhatsApp requires the 24h session window which we no
    // longer track. Always send as the AM's personal universal template
    // (`rl_universal_<voornaam>`) - the edited free text rides as the
    // single body parameter. Same pattern the old "outside-window"
    // branch already used; we just promoted it to be the only path.
    const { data: sender } = await supabase
      .from("users")
      .select("name")
      .eq("id", senderUserId)
      .maybeSingle<{ name: string | null }>()
    const resolvedTemplate = hardcodedTemplateName(sender?.name ?? "", "universal")
    if (!resolvedTemplate) {
      return NextResponse.json(
        {
          error: `Kan geen WhatsApp template afleiden uit ${sender?.name ?? "de sender"}. Verifieer dat users.name een geldige voornaam bevat.`,
        },
        { status: 400 },
      )
    }
    templateName = resolvedTemplate

    const waChannel = await findAmWaChannel(senderUserId)
    if (!waChannel) {
      return NextResponse.json(
        {
          error:
            "De sender heeft geen outbound WhatsApp channel geselecteerd in /account. Kies er één en probeer opnieuw.",
        },
        { status: 400 },
      )
    }

    try {
      const sent = await sendTrengoTemplateToPhoneAsUser(
        senderUserId,
        recipientPhone,
        templateName,
        [trimmed],
        waChannel.id,
      )
      outboundId = sent.message_id
      outboundChannelLabel = "trengo_whatsapp_template"
    } catch (e) {
      if (e instanceof NeedsConnectError) {
        return NextResponse.json(
          { error: "De sender heeft Trengo nog niet verbonden in /account." },
          { status: 409 },
        )
      }
      return NextResponse.json(
        {
          error: `WhatsApp template send mislukt: ${e instanceof Error ? e.message : String(e)}. Verifieer dat '${templateName}' approved is in Trengo.`,
        },
        { status: 502 },
      )
    }
  } else {
    // Email: bootstrap a fresh ticket on the sender's primary email
    // channel. No ticket lookup, no stored Trengo contact id needed -
    // Trengo resolves or creates the contact from the email address.
    const emailChannel = await findAmEmailChannel(senderUserId)
    if (!emailChannel) {
      return NextResponse.json(
        {
          error:
            "De sender heeft geen outbound email-channel geselecteerd in /account. Kies er één en probeer opnieuw.",
        },
        { status: 400 },
      )
    }
    try {
      const subject =
        (task.source_ref as Record<string, unknown> | null)?.draft_subject as string | undefined
      // Direct send — same shape as wa_sessions, Trengo owns the contact
      // step internally so we sidestep the private/personal contact-
      // channel pairing mismatch entirely.
      const sent = await sendEmailToAddressAsUser({
        userToken,
        channelId: emailChannel.id,
        email: recipientEmail,
        name: mondayClient.companyName || mondayClient.name || recipientEmail,
        subject:
          (subject && subject.trim()) ||
          `${mondayClient.companyName || mondayClient.name}`,
        body: trimmed,
      })
      outboundId = sent.messageId
      ticketId = sent.ticketId
      outboundChannelLabel = "trengo_email"
    } catch (e) {
      return NextResponse.json(
        {
          error: `Kan geen email-ticket aanmaken in Trengo: ${e instanceof Error ? e.message : String(e)}`,
        },
        { status: 502 },
      )
    }
  }

  const sentAt = new Date().toISOString()
  const channelHuman = outboundChannelLabel === "trengo_email" ? "email" : "WhatsApp"
  const ticketPart = ticketId ? `ticket ${ticketId}, ` : ""
  const auditNote = `\n\n- Verstuurd via Trengo ${channelHuman} (${ticketPart}message ${outboundId}) op ${sentAt.slice(0, 10)}.`
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
        ...(templateName ? { sent_template_name: templateName } : {}),
        ...(ticketId ? { sent_ticket_id: ticketId } : {}),
        sent_message_id: outboundId,
        sent_at: sentAt,
      },
    })
    .eq("id", taskId)
    .in("status", ["open", "in_progress"])

  return NextResponse.json({
    ok: true,
    ticketId,
    messageId: outboundId,
    channel: outboundChannelLabel,
    templateName,
  })
}
