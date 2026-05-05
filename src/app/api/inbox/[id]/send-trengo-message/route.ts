import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchConversations } from "@/lib/integrations/trengo"
import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"
import { NextRequest, NextResponse } from "next/server"

/**
 * Smart-inbox send: post the AM's edited draft as a reply on the client's
 * most recent EMAIL ticket in Trengo, then mark the originating Hub task as
 * done with an audit note.
 *
 * Why limit to email for v1:
 *  - WhatsApp Business has a 24-hour session window outside which only
 *    pre-approved template messages can be sent. Detecting + handling that
 *    correctly is its own slice — not worth blocking the payment-reminder
 *    use case on it.
 *  - Email is the more appropriate channel for a payment reminder anyway.
 *
 * Posts via the user's *personal* Trengo token so the message lands as them
 * in Trengo, not as the system bot. Same replies-as-self pattern as
 * /api/inbox/[id]/reply. Blocks with 409 if the user hasn't connected.
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

  // Pull the task + the linked client. We need:
  //  - task to mark done after send + record audit
  //  - client.trengo_contact_id to look up conversations
  //  - client_id is text (Monday item id), so we go through clients table.
  const { data: task } = await supabase
    .from("inbox_events")
    .select("id, client_id, status, source_ref, body")
    .eq("id", taskId)
    .maybeSingle<{
      id: string
      client_id: string | null
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

  // Honor the draft_channel that was decided at task-creation time. WhatsApp
  // outside the 24h session window requires Trengo template messages, which
  // is its own beast — for now we hard-block WA sends and tell the AM to do
  // it manually. Email path is the only fully-automated send.
  const draftChannel = (task.source_ref as Record<string, unknown> | null)?.draft_channel
  if (draftChannel === "trengo_whatsapp") {
    return NextResponse.json(
      {
        error:
          "WhatsApp-versturen via de Hub is nog niet ondersteund (Trengo vraagt om een goedgekeurde template). Kopieer de tekst en stuur 'm even handmatig vanuit Trengo.",
      },
      { status: 501 },
    )
  }

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

  // Personal Trengo token — fail fast with a 409 + friendly message that the
  // UI can surface as "Connect your Trengo in Settings → My Account first".
  const userToken = await getUserPlatformToken(session.user.id, "trengo")
  if (!userToken) {
    return NextResponse.json(
      { error: "Connect your Trengo account first (Settings → My Account)." },
      { status: 409 },
    )
  }

  // Pick the most recent EMAIL ticket. fetchConversations returns newest-first
  // and includes channel info. Anything WhatsApp-shaped is filtered out for
  // v1 (see header comment).
  let conversations
  try {
    conversations = await fetchConversations(trengoContactId)
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to look up Trengo conversations: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

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

  // Post via the user's personal token so it lands as the AM in Trengo.
  let outboundId: string
  try {
    const res = await fetch(`https://app.trengo.com/api/v2/tickets/${emailTicket.id}/messages`, {
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

  // Mark the task done with an audit note and record the outbound details so
  // the timeline can show "Sent Trengo message {id} on {date}" later.
  const sentAt = new Date().toISOString()
  const auditNote = `\n\n— Verstuurd via Trengo (ticket ${emailTicket.id}, message ${outboundId}) op ${sentAt.slice(0, 10)}.`
  const sourceRef = (task.source_ref ?? {}) as Record<string, unknown>
  await supabase
    .from("inbox_events")
    .update({
      status: "done",
      completed_at: sentAt,
      body: (task.body ?? "") + auditNote,
      source_ref: {
        ...sourceRef,
        sent_via: "trengo_email",
        sent_ticket_id: emailTicket.id,
        sent_message_id: outboundId,
        sent_at: sentAt,
      },
    })
    .eq("id", taskId)
    .in("status", ["open", "in_progress"])

  return NextResponse.json({
    ok: true,
    ticketId: emailTicket.id,
    messageId: outboundId,
    channel: emailTicket.channel?.type ?? null,
  })
}

/** Trengo channel types vary in casing/spelling between accounts; treat any
 *  string mentioning "email" or "mail" as email-suitable. */
function isEmailChannel(type: string | null): boolean {
  if (!type) return false
  const lower = type.toLowerCase()
  return lower.includes("email") || lower.includes("mail")
}
