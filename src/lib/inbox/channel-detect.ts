import { fetchConversations } from "@/lib/integrations/trengo"

/**
 * Detect the client's most-active Trengo channel by counting recent
 * conversations per channel-type. Returns 'email' or 'whatsapp' (the only
 * two we differentiate for now), or null when no Trengo history exists.
 *
 * Heuristic: most recent ~20 conversations weigh equal - channel that owns
 * the majority wins. Ties go to email (more appropriate for finance + admin
 * comms by default).
 *
 * Failure mode: when Trengo is unreachable we return null so callers default
 * to email-tone - safer than guessing.
 *
 * Used by every smart-inbox drafter (payment reminder, CPL drop signal,
 * Fathom follow-up) so the channel pick is consistent across rules.
 */
export async function detectMostActiveTrengoChannel(
  trengoContactId: string,
): Promise<"email" | "whatsapp" | null> {
  try {
    const all = await fetchConversations(trengoContactId)
    if (all.length === 0) return null
    const recent = all.slice(0, 20)
    let email = 0
    let whatsapp = 0
    for (const c of recent) {
      const type = (c.channel?.type ?? "").toLowerCase()
      if (type.includes("email") || type.includes("mail")) email++
      else if (type.includes("whats") || type.includes("wa_")) whatsapp++
    }
    if (whatsapp > email) return "whatsapp"
    if (email > 0 || whatsapp > 0) return "email"
    return null
  } catch (e) {
    console.error("Channel detection failed for", trengoContactId, e)
    return null
  }
}
