import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchClientById } from "@/lib/integrations/monday"
import {
  findAmEmailChannel,
  findAmWaChannel,
  sendEmailToAddressAsUser,
} from "@/lib/integrations/trengo"
import {
  sendTrengoTemplateToPhoneAsUser,
  sanitizeWaTemplateParam,
  NeedsConnectError,
} from "@/lib/inbox/reply"
import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"
import { getCanonicalThreadBases } from "@/lib/inbox/trengo-contacts"
import { resolveWeeklyUpdateTemplate } from "@/lib/clients/resolve-wa-template"
import { resolveAmUserIdForClient } from "@/lib/clients/build-weekly-update-draft"
import {
  partsToWeeklyUpdateParams,
  type EditableParts,
} from "@/lib/clients/client-update-template"
import { resolveClientSendChannel } from "@/lib/clients/send-channel"
import { NextRequest, NextResponse } from "next/server"

/**
 * Send a Hub-composed client update via Trengo.
 *
 * 2026-06-12 rewrite: routing is now driven by Monday's `phone` + `email`
 * columns + the `contactChannel` preferred-channel status, NOT by a stored
 * `trengo_contact_id` + ticket lookup. The old flow kept 404'ing on
 * create-ticket / 422'ing on private-vs-public contact mismatches because
 * the Trengo contact-id record drifted from the channel the AM tried to
 * send on.
 *
 * The new flow:
 *  - WhatsApp: `sendTrengoTemplateToPhoneAsUser` posts the HSM template
 *    straight to `/v2/wa_sessions` with `recipient_phone_number`. Trengo
 *    spawns the contact + ticket server-side. No lookup needed.
 *  - Email: `findOrCreateTrengoEmailContact` resolves/creates a Trengo
 *    contact bound to the AM's email channel, then
 *    `createEmailMessageForContact` opens a fresh ticket with the body.
 *    Each weekly update spawns a fresh email thread - matches how AMs
 *    actually expect "wekelijkse update" to appear in the customer's
 *    inbox (one mail, one subject, no growing thread).
 *
 * Channel preference (`resolveClientSendChannel`):
 *  - Monday `contactChannel` status wins (WhatsApp / Email)
 *  - Falls back to whichever column is filled, WhatsApp first
 *  - Returns a structured error when neither column is set
 *
 * Test mode (`testEmail` / `testPhone`) bypasses the Monday contact info
 * and addresses the supplied test recipient via the same send paths.
 * Useful for AMs sanity-checking a template's HSM resolution against
 * their own phone without touching a real client.
 *
 * Sends as the AM (not the logged-in user) so the customer sees the
 * AM's name + the AM's selected outbound channel as the From - Roy
 * clicking Send for Roel's client should land as Roel in Trengo.
 *
 * Failure modes:
 *   - Neither phone nor email on Monday → 400, "no_contact_info"
 *   - AM has no WhatsApp template registered → 400, "no_wa_template"
 *   - AM has no outbound channel selected → 400, "am_*_channel_missing"
 *   - AM hasn't connected Trengo → 400, "am_trengo_not_connected"
 *   - User hasn't connected Trengo (test mode) → 401, "needs_connect"
 */

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
     *  shipping the whole rendered body as `{{1}}`. Optional - V1 path
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

    // Resolve outbound channel from Monday columns. The new canonical
    // routing - replaces the old `client.trengoContactId` + conversation
    // lookup. Test mode overrides the channel kind via test inputs below
    // (testEmail forces email, testPhone forces WhatsApp), so the
    // resolve-failure branch only matters for real client sends.
    const resolved = resolveClientSendChannel(client)

    // Channel kind for the rest of the route. In test mode we force the
    // kind from which test input is filled, falling back to the resolved
    // client channel when no test input was set.
    let channelKind: "whatsapp" | "email"
    if (testMode) {
      channelKind = testEmail ? "email" : testPhone ? "whatsapp" : resolved.ok ? resolved.channel.kind : "whatsapp"
    } else {
      if (!resolved.ok) {
        return NextResponse.json(
          { error: "no_contact_info", message: resolved.message },
          { status: 400 },
        )
      }
      channelKind = resolved.channel.kind
    }

    const sendAsEmail = channelKind === "email"

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

    // Recipient address - test inputs win when set, else use the
    // resolved client channel. Test mode keeps both branches symmetrical
    // with regular sends (same send fn, same AM channel, same token).
    let recipientPhone = ""
    let recipientEmail = ""
    if (sendAsEmail) {
      if (testMode) {
        if (!testEmail) {
          return NextResponse.json(
            { error: "test_email_required", message: "Vul een test email-adres in het send-dialog in." },
            { status: 400 },
          )
        }
        recipientEmail = testEmail
      } else if (resolved.ok && resolved.channel.kind === "email") {
        recipientEmail = resolved.channel.email
      }
    } else {
      if (testMode) {
        if (!testPhone) {
          return NextResponse.json(
            {
              error: "test_phone_required",
              message: "Vul een test telefoonnummer in het send-dialog in (E.164, bv. +31612345678).",
            },
            { status: 400 },
          )
        }
        recipientPhone = testPhone
      } else if (resolved.ok && resolved.channel.kind === "whatsapp") {
        recipientPhone = resolved.channel.phone
      }
    }

    // Look up the Hub-side client row for the mirror + audit writes.
    // Test mode skips audit/mirror (it's not a real client send), so we
    // only need this for the production paths.
    const supabase = await createAdminClient()
    let clientRowId: string | null = null
    if (!testMode) {
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
      clientRowId = clientRow.id as string
    }

    // Need the AM's Trengo token + the right outbound channel for both
    // paths. We resolve them up-front so we can return a single, clear
    // error before any side effects fire.
    const amToken = await getUserPlatformToken(amUserId, "trengo")
    if (!amToken) {
      return NextResponse.json(
        {
          error: "am_trengo_not_connected",
          message:
            "De AM van deze klant heeft Trengo nog niet verbonden in /account. Laat 'm Trengo daar koppelen en probeer opnieuw - anders kunnen we niet als hen versturen.",
        },
        { status: 400 },
      )
    }

    let outboundId: string
    let ticketId: string | null = null
    let channelId: number | null = null

    if (sendAsEmail) {
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
      channelId = emailChannel.id

      try {
        // Direct send: Trengo resolves the contact internally from the
        // email address — same shape as wa_sessions for WhatsApp. No
        // contact_id juggling, no privacy-pairing mismatch.
        const sent = await sendEmailToAddressAsUser({
          userToken: amToken,
          channelId: emailChannel.id,
          email: recipientEmail,
          name: testMode ? "Hub Test" : (client.companyName || client.name || recipientEmail),
          subject:
            subjectOverride ||
            `Wekelijkse update ${client.companyName || client.name}`,
          body: message,
        })
        outboundId = sent.messageId
        ticketId = sent.ticketId
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
    } else {
      const waChannel = await findAmWaChannel(amUserId)
      if (!waChannel) {
        return NextResponse.json(
          {
            error: "am_wa_channel_missing",
            message:
              "De AM heeft geen outbound WhatsApp channel geselecteerd in /account → Outbound sender channels. Kies daar de channel waar de HSM template approved is en probeer opnieuw.",
          },
          { status: 400 },
        )
      }
      channelId = waChannel.id

      try {
        const sent = await sendTrengoTemplateToPhoneAsUser(
          amUserId,
          recipientPhone,
          templateName,
          templateParams,
          waChannel.id,
        )
        outboundId = sent.message_id
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
            error: "wa_send_failed",
            message: `WhatsApp send mislukt: ${e instanceof Error ? e.message : "unknown"}`,
          },
          { status: 502 },
        )
      }
    }

    if (testMode) {
      return NextResponse.json({
        test: true,
        channel: sendAsEmail ? "email" : "whatsapp",
        outboundMsgId: outboundId,
        ticketId,
        recipientEmail: sendAsEmail ? recipientEmail : undefined,
        recipientPhone: sendAsEmail ? undefined : recipientPhone,
      })
    }

    // Mirror the outbound into inbox_events so the chat-pane history
    // matches what the customer received. Thread key falls back to the
    // Hub client id when no Trengo contact id is known - chat pane
    // groups by thread_key, so the client id is the right anchor when
    // we no longer rely on stored Trengo contact records.
    const { data: hubUser } = await supabase
      .from("users")
      .select("id, name, email")
      .eq("id", session.user.id)
      .maybeSingle<{ id: string; name: string | null; email: string | null }>()

    // WhatsApp sends were flattened by sanitizeWaTemplateParam at the API
    // boundary - mirror what the customer actually received (single-line
    // with " • " bullets). Email keeps the original multi-line body since
    // email accepts newlines natively.
    const previewSource = sendAsEmail ? message : sanitizeWaTemplateParam(message)
    const titlePreview =
      previewSource.length > 100 ? previewSource.slice(0, 100) + "…" : previewSource
    const bodyFull = previewSource.length > 100 ? previewSource : null
    const createdAtSrc = new Date().toISOString()

    // Key the mirror on the CANONICAL base (phone when known) so a weekly-update
    // push merges into the client's live conversation instead of spawning a
    // separate contact-keyed thread. Roy 2026-07-22.
    let threadKey = `client:${clientRowId}`
    if (client.trengoContactId) {
      const canon = await getCanonicalThreadBases(supabase, [Number(client.trengoContactId)])
      threadKey =
        canon.get(Number(client.trengoContactId)) ?? `trengo:contact:${client.trengoContactId}`
    }
    const sourceThread = ticketId
      ? `trengo:ticket:${ticketId}`
      : `client:${clientRowId}:${sendAsEmail ? "email" : "whatsapp"}`

    const { data: inserted } = await supabase
      .from("inbox_events")
      .insert({
        kind: "chat",
        // inbox_events.client_id is the Monday item id (that's what the chat
        // grouping's client map is keyed on) - NOT the clients-table UUID. Using
        // the UUID here left the mirrored weekly-update threads unresolvable →
        // they rendered "Unknown" instead of the client name. Roy 2026-07-22.
        client_id: mondayItemId,
        author_id: session.user.id,
        assignee_id: session.user.id,
        title: titlePreview,
        body: bodyFull,
        status: "read",
        source: "trengo",
        source_thread: sourceThread,
        source_msg_id: `trengo:msg:${outboundId}`,
        thread_key: threadKey,
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

    const result = {
      source: "trengo" as const,
      outboundMsgId: outboundId,
      inboxEventId: (inserted?.id as string) ?? "",
    }

    // Audit + freshness signal. The log row backs future history views; the
    // mirrored `last_client_update_at` on `clients` keeps the All Clients
    // list query cheap (no aggregate, no extra join). Both writes are
    // best-effort: a Supabase outage shouldn't undo the WhatsApp send.
    const sentAt = new Date().toISOString()
    const snippetSource = sendAsEmail ? message : sanitizeWaTemplateParam(message)
    const previewSnippet =
      snippetSource.length > 240 ? snippetSource.slice(0, 237) + "…" : snippetSource
    try {
      await Promise.all([
        supabase.from("client_updates").insert({
          client_id: clientRowId,
          sent_at: sentAt,
          sent_by_user_id: session.user.id,
          message_preview: previewSnippet,
          template_name: sendAsEmail ? null : templateName,
          trengo_message_id: result.outboundMsgId,
        }),
        supabase
          .from("clients")
          .update({ last_client_update_at: sentAt })
          .eq("id", clientRowId),
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
