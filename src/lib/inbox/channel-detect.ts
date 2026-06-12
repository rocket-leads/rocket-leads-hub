import type { MondayClient } from "@/lib/integrations/monday"
import { resolveClientSendChannel } from "@/lib/clients/send-channel"

/**
 * Detect the client's preferred outbound channel from Monday columns.
 *
 * Was an aggregate query over Trengo conversation history (most-active
 * channel-type wins); retired 2026-06-12 in favour of Monday's canonical
 * `contactChannel` + `phone` + `email` columns - the same signal the
 * send pipeline now uses, so drafter + sender agree on channel.
 *
 * Returns 'email' or 'whatsapp' (the only two we differentiate), or null
 * when neither column is filled. Callers default to email-tone on null -
 * safer than guessing.
 *
 * Used by every smart-inbox drafter (payment reminder, CPL drop signal,
 * Fathom follow-up) so the channel pick is consistent across rules.
 */
export function detectClientChannel(
  client: Pick<MondayClient, "phone" | "email" | "contactChannel"> | null | undefined,
): "email" | "whatsapp" | null {
  if (!client) return null
  const resolved = resolveClientSendChannel({
    phone: client.phone,
    email: client.email,
    contactChannel: client.contactChannel,
  })
  if (!resolved.ok) return null
  return resolved.channel.kind
}

/**
 * Back-compat alias. The old function took a Trengo contact id and went
 * over the network; the new behaviour is a synchronous Monday read. Kept
 * the original name with the old async signature so the call sites in
 * `lib/inbox/automations.ts` can be migrated one rule at a time without
 * a flag day.
 *
 * Prefer `detectClientChannel(client)` in new code - the Trengo contact
 * id argument is ignored and only kept for the type signature.
 */
export async function detectMostActiveTrengoChannel(
  _trengoContactId: string,
  client?: Pick<MondayClient, "phone" | "email" | "contactChannel"> | null,
): Promise<"email" | "whatsapp" | null> {
  return detectClientChannel(client ?? null)
}
