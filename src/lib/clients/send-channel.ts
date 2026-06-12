import type { MondayClient } from "@/lib/integrations/monday"

/**
 * Send-channel decision for outbound messages to a client (weekly updates,
 * automation drafts, ad-hoc inbox composes). Replaces the old flow that
 * looked up `client.trengoContactId` and tried to find a matching ticket
 * in Trengo - that path 404'd whenever the contact wasn't on the AM's
 * channel and 422'd on private-vs-public mismatches.
 *
 * Routing precedence:
 *  1. Monday's `contactChannel` status column (canonical preferred channel,
 *     editable per client) - "WhatsApp" or "Email"
 *  2. If contactChannel is empty/unknown: WhatsApp wins when phone is set,
 *     else email. Roy's rule (2026-06-12): WhatsApp is the primary outbound
 *     channel for client comms.
 *
 * The send paths (`sendTrengoTemplateToPhoneAsUser` for WhatsApp,
 * `findOrCreateTrengoEmailContact` + `createEmailMessageForContact` for
 * email) take the raw phone/email and don't need any stored Trengo
 * contact-id - Trengo resolves or creates the contact server-side.
 */
export type ClientSendChannel =
  | { kind: "whatsapp"; phone: string }
  | { kind: "email"; email: string }

export type SendChannelError =
  | "no_contact_columns"
  | "preferred_whatsapp_no_phone"
  | "preferred_email_no_email"

export type ResolveSendChannelResult =
  | { ok: true; channel: ClientSendChannel }
  | { ok: false; error: SendChannelError; message: string }

type ChannelInput = {
  phone?: string | null
  email?: string | null
  contactChannel?: string | null
}

function normalisePhone(raw: string | null | undefined): string {
  if (!raw) return ""
  // Trengo's wa_sessions endpoint wants an E.164-ish phone with no
  // whitespace, dashes, dots, or parens. Strip everything that isn't
  // digit or leading +. Empty string after stripping = treat as unset.
  const trimmed = raw.trim()
  if (!trimmed) return ""
  const cleaned = trimmed.replace(/[^\d+]/g, "")
  // A bare "+" or fewer than 6 digits is junk - never enough to dial.
  const digits = cleaned.replace(/\+/g, "")
  if (digits.length < 6) return ""
  return cleaned
}

function normaliseEmail(raw: string | null | undefined): string {
  if (!raw) return ""
  const trimmed = raw.trim().toLowerCase()
  // Cheap shape check - the real validation happens at Trengo's side
  // when we hit /contacts. Anything without `@` and a dot in the host
  // can't be a deliverable address.
  if (!trimmed.includes("@")) return ""
  const [, host] = trimmed.split("@")
  if (!host || !host.includes(".")) return ""
  return trimmed
}

function detectPreference(contactChannel: string | null | undefined): "whatsapp" | "email" | null {
  if (!contactChannel) return null
  const s = contactChannel.toLowerCase()
  if (s.includes("whatsapp") || s.includes("wa")) return "whatsapp"
  if (s.includes("email") || s.includes("mail")) return "email"
  return null
}

export function resolveClientSendChannel(
  input: ChannelInput | MondayClient,
): ResolveSendChannelResult {
  const phone = normalisePhone(input.phone ?? "")
  const email = normaliseEmail(input.email ?? "")
  const pref = detectPreference(input.contactChannel ?? "")

  if (pref === "whatsapp") {
    if (phone) return { ok: true, channel: { kind: "whatsapp", phone } }
    if (email) return { ok: true, channel: { kind: "email", email } }
    return {
      ok: false,
      error: "preferred_whatsapp_no_phone",
      message:
        "Preferred contact channel is WhatsApp but the Monday phone column is empty for this client.",
    }
  }

  if (pref === "email") {
    if (email) return { ok: true, channel: { kind: "email", email } }
    if (phone) return { ok: true, channel: { kind: "whatsapp", phone } }
    return {
      ok: false,
      error: "preferred_email_no_email",
      message:
        "Preferred contact channel is Email but the Monday email column is empty for this client.",
    }
  }

  // No preference set: WhatsApp wins when available, else email.
  if (phone) return { ok: true, channel: { kind: "whatsapp", phone } }
  if (email) return { ok: true, channel: { kind: "email", email } }
  return {
    ok: false,
    error: "no_contact_columns",
    message:
      "This client has no phone or email filled in Monday. Fill the WhatsApp number or email column on the Monday client row before sending.",
  }
}

/**
 * Display label for the resolved channel. Used in dialogs/toasts so AM
 * sees which path the send will take ("WhatsApp" / "Email").
 */
export function describeChannel(channel: ClientSendChannel): string {
  return channel.kind === "whatsapp" ? "WhatsApp" : "Email"
}
