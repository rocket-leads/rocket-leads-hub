import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchClientById } from "@/lib/integrations/monday"
import {
  fetchConversations,
  findAmEmailChannel,
  findAmWaChannel,
  findOrCreateTrengoEmailContact,
  createEmailMessageForContact,
  type TrengoConversation,
} from "@/lib/integrations/trengo"
import {
  sendTrengoTemplateAsUser,
  sendTrengoTemplateToPhoneAsUser,
  sendTrengoReplyAsUser,
  sanitizeWaTemplateParam,
  NeedsConnectError,
} from "@/lib/inbox/reply"
import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"
import { resolveWeeklyUpdateTemplate } from "@/lib/clients/resolve-wa-template"
import { resolveAmUserIdForClient } from "@/lib/clients/build-weekly-update-draft"
import {
  partsToWeeklyUpdateParams,
  type EditableParts,
} from "@/lib/clients/client-update-template"
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
 * Threading: when the Hub already has an `inbox_events` row from this Trengo
 * conversation we use that as the anchor (drops us into the existing reply
 * pipeline with mirror writes for free). When there's no Hub anchor yet —
 * webhook hasn't backfilled, brand-new ticket — we send the template
 * DIRECTLY to the latest Trengo WhatsApp ticket and write the mirror row
 * ourselves. The AM should never have to "open the Inbox tab first" just
 * to unblock a send.
 *
 * Failure modes (all surface as JSON errors so the composer can render them):
 *   - No Trengo contact linked on the Monday item → 400, "no_trengo_contact"
 *   - AM has no WhatsApp template registered → 400, "no_wa_template"
 *   - Contact has zero Trengo tickets ever → 400, "no_active_conversation"
 *   - User hasn't connected Trengo → 401, "needs_connect"
 */

/** Trengo's channel.type for WhatsApp varies slightly across workspaces
 *  ("WA_BUSINESS", "whatsapp", "WHATSAPP_BUSINESS", …) so we match
 *  permissively. Returns false on null/undefined types so non-WhatsApp
 *  channels (email, voice) sort to the bottom of the picker. */
function isWhatsAppChannel(type: string | null | undefined): boolean {
  if (!type) return false
  return /whats/i.test(type) || /^wa[_-]?/i.test(type)
}

/** Email channel detector — same shape as the WhatsApp one. Used to pick the
 *  right ticket when we have no Hub anchor for an email send. */
function isEmailChannel(type: string | null | undefined): boolean {
  if (!type) return false
  return /e?mail/i.test(type)
}

/** Channel preference from the Monday `contact_channel` column label. Mirrors
 *  the detectChannel in /client-update; kept here so the send route is
 *  self-contained (no shared import for one tiny function). */
function preferEmail(contactChannel: string | null | undefined): boolean {
  if (!contactChannel) return false
  return /e?mail/i.test(contactChannel)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const body = (await req.json().catch(() => ({}))) as {
    message?: string
    subject?: string
    /** V2 multi-variable template path: the dialog ships the full editable
     *  parts alongside the rendered `message`. When present + feature flag
     *  on + weekly template approved, we derive 5 vars from this instead of
     *  shipping the whole rendered body as `{{1}}`. Optional — V1 path
     *  ignores it entirely. */
    parts?: EditableParts
  }
  const message = (body.message ?? "").trim()
  const subjectOverride = (body.subject ?? "").trim()
  const editableParts = body.parts ?? null
  const extras = body as {
    test?: boolean
    testEmail?: string
    testPhone?: string
  }
  const testMode = extras.test === true
  const testEmail = (extras.testEmail ?? "").trim()
  const testPhone = (extras.testPhone ?? "").trim()
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

    // Channel routes the send: email goes as free-text with a subject (no HSM
    // template needed — Meta's template-only rule is WhatsApp-specific),
    // WhatsApp goes through one of two HSM templates.
    const sendAsEmail = preferEmail(client.contactChannel)

    // WhatsApp send always uses the assigned AM's weekly template
    // (`rl_weekly_<voornaam>`), regardless of who's logged in. Roy
    // reviewing Danny's client still sends out `rl_weekly_danny` so
    // the customer sees "Groetjes, Danny" and the channel's
    // template-approval matches. Falls back to logged-in user when no
    // AM mapping exists.
    const amUserId = (await resolveAmUserIdForClient(client)) ?? session.user.id
    const waTemplate = sendAsEmail
      ? { name: null as string | null, source: "none" as const }
      : await resolveWeeklyUpdateTemplate({ userId: amUserId, mondayItemId })

    if (!sendAsEmail && !waTemplate.name) {
      return NextResponse.json(
        {
          error: "no_wa_template",
          message:
            "Kan WhatsApp template niet afleiden voor de AM van deze klant. Verwacht `rl_weekly_<voornaam>` (bijv. rl_weekly_danny). Check Monday accountManager + Settings → Users mapping.",
        },
        { status: 400 },
      )
    }
    const templateName = waTemplate.name ?? ""

    // Template params: 5 derived vars matching the approved 5-variable
    // body. When the dialog skipped shipping `parts` (legacy code paths),
    // fall back to dumping the rendered message into a single param.
    const templateParams: string[] = editableParts
      ? partsToWeeklyUpdateParams(editableParts)
      : [message]

    // Test mode: short-circuit the entire conversation-routing dance and
    // deliver the rendered message to an ad-hoc address supplied at send
    // time (no persisted "test contact" lookup — testing is rare, the
    // dialog just remembers via localStorage). Uses the AM's outbound
    // channels + token + template, so the test is end-to-end faithful —
    // only the destination is swapped. Skips the inbox_events mirror +
    // client_updates audit (this isn't a real client communication).
    if (testMode) {
      if (sendAsEmail) {
        if (!testEmail) {
          return NextResponse.json(
            {
              error: "test_email_required",
              message: "Vul een test email-adres in het send-dialog in.",
            },
            { status: 400 },
          )
        }
        const emailChannel = await findAmEmailChannel(amUserId)
        if (!emailChannel) {
          return NextResponse.json(
            {
              error: "am_email_channel_missing",
              message:
                "De AM van deze klant heeft geen outbound email-channel geselecteerd in Settings → Users. Kies daar één email-channel en probeer opnieuw.",
            },
            { status: 400 },
          )
        }
        const amToken = await getUserPlatformToken(amUserId, "trengo")
        if (!amToken) {
          return NextResponse.json(
            {
              error: "am_trengo_not_connected",
              message:
                "De AM van deze klant heeft Trengo nog niet verbonden in /account.",
            },
            { status: 400 },
          )
        }
        try {
          const contact = await findOrCreateTrengoEmailContact({
            userToken: amToken,
            channelId: emailChannel.id,
            email: testEmail,
            name: "Hub Test",
          })
          const sent = await createEmailMessageForContact({
            userToken: amToken,
            contactId: String(contact.id),
            channelId: emailChannel.id,
            subject:
              subjectOverride ||
              `Wekelijkse update ${client.companyName || client.name}`,
            body: message,
          })
          return NextResponse.json({
            test: true,
            channel: "email",
            outboundMsgId: sent.messageId,
            ticketId: sent.ticketId,
            recipientEmail: testEmail,
          })
        } catch (e) {
          return NextResponse.json(
            {
              error: "test_email_send_failed",
              message: `Test email send mislukt: ${
                e instanceof Error ? e.message : "unknown"
              }`,
            },
            { status: 502 },
          )
        }
      } else {
        // WhatsApp test: skip the existing-ticket requirement entirely
        // and go straight to /v2/wa_sessions with the supplied phone.
        // Requires AM to have set primary_wa_channel_id (the channel
        // the HSM template is approved on).
        if (!testPhone) {
          return NextResponse.json(
            {
              error: "test_phone_required",
              message: "Vul een test telefoonnummer in het send-dialog in (E.164, bv. +31612345678).",
            },
            { status: 400 },
          )
        }
        const waChannel = await findAmWaChannel(amUserId)
        if (!waChannel) {
          return NextResponse.json(
            {
              error: "am_wa_channel_missing",
              message:
                "De AM heeft geen outbound WhatsApp channel geselecteerd in Settings → Users. Kies daar de channel waar de HSM template approved is en probeer opnieuw.",
            },
            { status: 400 },
          )
        }
        try {
          const sent = await sendTrengoTemplateToPhoneAsUser(
            amUserId,
            testPhone,
            templateName,
            templateParams,
            waChannel.id,
          )
          return NextResponse.json({
            test: true,
            channel: "whatsapp",
            outboundMsgId: sent.message_id,
            recipientPhone: testPhone,
          })
        } catch (e) {
          if (e instanceof NeedsConnectError) {
            return NextResponse.json(
              {
                error: "am_trengo_not_connected",
                message: "De AM van deze klant heeft Trengo nog niet verbonden in /account.",
              },
              { status: 400 },
            )
          }
          return NextResponse.json(
            {
              error: "test_wa_send_failed",
              message: `Test WhatsApp send mislukt: ${
                e instanceof Error ? e.message : "unknown"
              }`,
            },
            { status: 502 },
          )
        }
      }
    }

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

    // Channel routing for client-update sends is ALWAYS done via the live
    // Trengo conversation list — we no longer use a "last inbox_event"
    // anchor for threading. Two bugs the anchor caused:
    //   1. Email sends could land in a WhatsApp ticket when the latest
    //      inbox_event happened to be a WA message (Dr. Ludidi case).
    //      Trengo rejected with "outside 24h window / SMS fallback" —
    //      WhatsApp constraints triggered by email content.
    //   2. WhatsApp sends could pick a channel where the AM's template
    //      isn't approved when the latest event was on a different WA
    //      channel than the one with the approved template.
    // Trade-off: slightly worse threading (a brand-new ticket may be
    // created when an old one would have worked). Worth it — sends are
    // rare, wrong channel breaks them entirely.
    const conversations = await fetchConversations(client.trengoContactId).catch(
      () => [] as TrengoConversation[],
    )
    if (conversations.length === 0) {
      return NextResponse.json(
        {
          error: "no_active_conversation",
          message:
            "Deze klant heeft nog geen enkel gesprek in Trengo. Start eerst handmatig een gesprek zodat er een contact-ticket bestaat, en probeer dan opnieuw.",
        },
        { status: 400 },
      )
    }

    // Strict channel-type matching — no silent fallback to `conversations[0]`
    // because that's exactly how the email-into-WA-ticket bug used to land.
    let ticket = sendAsEmail
      ? conversations.find((c) => isEmailChannel(c.channel?.type))
      : conversations.find((c) => isWhatsAppChannel(c.channel?.type))

    // Email fallback: when the contact has no email ticket yet (e.g.
    // Dr. Ludidi who's email-primary on Monday but has never been
    // emailed through Trengo before), bootstrap a fresh email ticket
    // on the AM's PERSONAL email channel — NOT the workspace's first
    // catch-all. Using `findFirstEmailChannel` previously caused the
    // mail to go out from `rocket-lea-mail.*@trengomail.com` (Trengo's
    // generic) instead of `roel@rocketleads.nl` (the channel Roel
    // actually selected in /account → Trengo Channels).
    //
    // We also send via the AM's own Trengo token now, so the ticket
    // gets attributed to the AM agent in Trengo — Roy clicking Send for
    // Roel's client should never make Roy the sender of record.
    //
    // WhatsApp has no equivalent fallback — outbound WhatsApp requires
    // an approved HSM template AND a known channel-with-approval combo,
    // which the bootstrap path can't produce safely.
    let bootstrappedEmail: { ticketId: string; messageId: string } | null = null
    if (!ticket && sendAsEmail) {
      const emailChannel = await findAmEmailChannel(amUserId)
      if (!emailChannel) {
        return NextResponse.json(
          {
            error: "am_email_channel_missing",
            message:
              "De AM van deze klant heeft geen outbound email-channel geselecteerd in /account → Outbound sender channels. Laat 'm daar één email-channel kiezen (de inbox waaruit klanten de mail moeten ontvangen) en probeer opnieuw.",
          },
          { status: 400 },
        )
      }
      const userToken = await getUserPlatformToken(amUserId, "trengo")
      if (!userToken) {
        return NextResponse.json(
          {
            error: "am_trengo_not_connected",
            message:
              "De AM van deze klant heeft Trengo nog niet verbonden in /account. Laat 'm Trengo daar koppelen en probeer opnieuw — anders kunnen we niet als hen versturen.",
          },
          { status: 400 },
        )
      }
      try {
        bootstrappedEmail = await createEmailMessageForContact({
          userToken,
          contactId: client.trengoContactId,
          channelId: emailChannel.id,
          subject:
            subjectOverride ||
            `Wekelijkse update ${client.companyName || client.name}`,
          body: message,
        })
      } catch (e) {
        return NextResponse.json(
          {
            error: "create_email_ticket_failed",
            message: `Kan geen nieuw email-ticket aanmaken in Trengo: ${
              e instanceof Error ? e.message : "unknown"
            }`,
          },
          { status: 502 },
        )
      }
      // Fake a ticket object so the mirror-insert below has the IDs.
      ticket = {
        id: Number(bootstrappedEmail.ticketId),
        status: "open",
        subject: null,
        channel: emailChannel,
        contact: null,
        latest_message: null,
        created_at: new Date().toISOString(),
        closed_at: null,
        assignee: null,
      }
    }

    if (!ticket) {
      const want = sendAsEmail ? "email" : "WhatsApp"
      const haveTypes = conversations
        .map((c) => c.channel?.type ?? "unknown")
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(", ")
      return NextResponse.json(
        {
          error: "no_channel_match",
          message: `Geen ${want}-ticket gevonden voor deze klant in Trengo (beschikbare channels: ${haveTypes || "geen"}). Open eerst een ${want}-gesprek met de klant in Trengo.`,
        },
        { status: 400 },
      )
    }
    const ticketId = String(ticket.id)
    const channelId = ticket.channel?.id ?? null

    let outboundId: string
    try {
      // Bootstrapped email already sent during create — skip the second
      // post, just adopt the new message id.
      if (bootstrappedEmail) {
        outboundId = bootstrappedEmail.messageId
      } else if (sendAsEmail) {
        // Reply path uses the AM's token too (same reasoning as the
        // bootstrap branch above): Roy clicking Send for Roel's client
        // should land as Roel in Trengo, with Roel's selected email
        // channel as the From — not session.user's.
        const amToken = await getUserPlatformToken(amUserId, "trengo")
        if (!amToken) {
          return NextResponse.json(
            {
              error: "am_trengo_not_connected",
              message:
                "De AM van deze klant heeft Trengo nog niet verbonden in /account. Laat 'm Trengo daar koppelen en probeer opnieuw — anders kunnen we niet als hen versturen.",
            },
            { status: 400 },
          )
        }
        const sent = await sendTrengoReplyAsUser(
          amUserId,
          ticketId,
          message,
          false,
          [],
          subjectOverride ? { subject: subjectOverride } : undefined,
        )
        outboundId = sent.message_id
      } else {
        const sent = await sendTrengoTemplateAsUser(
          session.user.id,
          ticketId,
          templateName,
          "nl",
          templateParams,
          channelId,
        )
        outboundId = sent.message_id
      }
    } catch (e) {
      if (e instanceof NeedsConnectError) throw e
      throw e
    }

    // Mirror the outbound into inbox_events so chat-pane history matches.
    const { data: hubUser } = await supabase
      .from("users")
      .select("id, name, email")
      .eq("id", session.user.id)
      .maybeSingle<{ id: string; name: string | null; email: string | null }>()

    // WhatsApp sends were flattened by sanitizeWaTemplateParam at the API
    // boundary — mirror what the customer actually received (single-line
    // with " • " bullets). Email keeps the original multi-line body since
    // email accepts newlines natively.
    const previewSource = sendAsEmail ? message : sanitizeWaTemplateParam(message)
    const titlePreview =
      previewSource.length > 100 ? previewSource.slice(0, 100) + "…" : previewSource
    const bodyFull = previewSource.length > 100 ? previewSource : null
    const createdAtSrc = new Date().toISOString()

    const { data: inserted } = await supabase
      .from("inbox_events")
      .insert({
        kind: "chat",
        client_id: clientRow.id,
        author_id: session.user.id,
        assignee_id: session.user.id,
        title: titlePreview,
        body: bodyFull,
        status: "read",
        source: "trengo",
        source_thread: `trengo:ticket:${ticketId}`,
        source_msg_id: `trengo:msg:${outboundId}`,
        thread_key: `trengo:contact:${client.trengoContactId}`,
        scope: "external",
        author_kind: "rl_team",
        author_external: null,
        author_name_cached: hubUser?.name ?? hubUser?.email ?? null,
        classify_method: "manual",
        created_at_src: createdAtSrc,
        trengo_channel_id: channelId,
        is_internal: false,
      })
      .select("id")
      .single()

    const result: {
      source: "trengo" | "slack"
      outboundMsgId: string
      inboxEventId: string
    } = {
      source: "trengo",
      outboundMsgId: outboundId,
      inboxEventId: (inserted?.id as string) ?? "",
    }

    // Audit + freshness signal. The log row backs future history views; the
    // mirrored `last_client_update_at` on `clients` keeps the All Clients
    // list query cheap (no aggregate, no extra join). Both writes are
    // best-effort: a Supabase outage shouldn't undo the WhatsApp send.
    const sentAt = new Date().toISOString()
    // Same flattening rule as the inbox mirror: WhatsApp snippet matches the
    // sanitised body the customer received; email snippet keeps newlines.
    const snippetSource = sendAsEmail ? message : sanitizeWaTemplateParam(message)
    const previewSnippet =
      snippetSource.length > 240 ? snippetSource.slice(0, 237) + "…" : snippetSource
    try {
      await Promise.all([
        supabase.from("client_updates").insert({
          client_id: clientRow.id,
          sent_at: sentAt,
          sent_by_user_id: session.user.id,
          message_preview: previewSnippet,
          template_name: sendAsEmail ? null : templateName,
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
      sentVia: sendAsEmail ? "trengo_email" : "trengo_whatsapp_template",
      templateName: sendAsEmail ? null : templateName,
      templateSource: sendAsEmail ? "none" : waTemplate.source,
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
