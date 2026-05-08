import Anthropic from "@anthropic-ai/sdk"
import { createHash } from "crypto"
import { readCache, writeCache } from "@/lib/cache"

const anthropic = new Anthropic()

/**
 * Generate a one-line Dutch title for an inbox event so the row shows a
 * human-readable summary instead of raw HTML or a truncated message blob.
 *
 * Roy's pain point: Monday updates surfaced as `<p><a class="user_mention…`
 * gibberish, and WhatsApp messages used the message body itself as the
 * title. Both forms were unreadable in the inbox list. With this helper
 * the title becomes something like "Vraag over leadkwaliteit Kobe" and the
 * original content moves to the body.
 *
 * Cached by SHA-256(content) so identical messages don't re-hit Haiku.
 * Cache TTL is effectively infinite (default cache_store has no expiry on
 * keys without a TTL hint) — the input is content-addressed, so a fresh
 * call would just produce the same output anyway.
 */
export async function summarizeInboxTitle(
  content: string,
  source: "trengo" | "monday" | "slack",
): Promise<string> {
  const cleaned = stripHtml(content).slice(0, 4000)
  if (!cleaned) return `Bericht via ${source}`

  // For very short messages a model summary just reformats the same words.
  // Skip the LLM and use the message itself.
  if (cleaned.length <= 70) return cleaned

  const hash = createHash("sha256").update(cleaned).digest("hex").slice(0, 24)
  const cacheKey = `inbox_title:${hash}`
  const cached = await readCache<string>(cacheKey)
  if (cached) return cached

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 80,
      system: `Vat het onderstaande bericht samen in één korte Nederlandse zin van maximaal 70 tekens.

Regels:
- Geen aanhalingstekens om de output.
- Geen prefix zoals "Titel:" of "Onderwerp:".
- Geen punt aan het einde.
- Vermijd vage woorden ("update", "bericht", "info") tenzij niet anders kan.
- Gebruik concreet jargon als het in het bericht staat (klantnaam, campagne, ad-account).
- Als de input HTML of een mention-link is, kijk naar de leesbare tekst en negeer de markup.

Output alleen de titel, niets anders.`,
      messages: [
        {
          role: "user",
          content: cleaned,
        },
      ],
    })
    const text = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : ""
    const title = text
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\.$/, "")
      .trim()
      .slice(0, 70)
    const finalTitle = title || cleaned.slice(0, 70)
    await writeCache(cacheKey, finalTitle)
    return finalTitle
  } catch (e) {
    console.error("[inbox-summarize] failed:", e instanceof Error ? e.message : e)
    return cleaned.slice(0, 70)
  }
}

/** Strip HTML tags + Monday's mention-router boilerplate so the LLM gets a
 *  clean text input. Also collapses whitespace runs which Monday updates
 *  embed copiously when copy-pasted. */
function stripHtml(input: string): string {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
}
