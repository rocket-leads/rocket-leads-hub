import Anthropic from "@anthropic-ai/sdk"

/**
 * Feedback scope classifier for Pedro's dual learning loop.
 *
 * Roy 2026-06-13. CM-feedback on generated creatives must be sorted
 * into two pools at insert time:
 *
 *   - "client" → STRICT per-klant. Brand / taste / audience preferences
 *                that don't generalise. Pedro must never repeat this
 *                mistake on THIS client.
 *                  Examples:
 *                  - "Logo's altijd klein voor Zumex"
 *                  - "Klant haat stock-photo's met te witte tanden"
 *                  - "Altijd minimaal 1 persoon in beeld"
 *
 *   - "global" → ADVISORY voor alle klanten. Generic craft / quality
 *                lessons that apply universally. Pedro decides per
 *                generation whether the rule is relevant in context.
 *                  Examples:
 *                  - "Geen doorstreping op tekst — leest als ontkenning"
 *                  - "Subjects groter in beeld — Meta-feed scan moment"
 *                  - "Geen glow op letters — slechte leesbaarheid"
 *
 *   - "both"   → Started client-specific but the underlying principle
 *                generalises. Saved against this client (strict) AND
 *                surfaced in the global pool.
 *                  Example: "Deze klant haat dat tekst glowed — en dat
 *                  is eigenlijk altijd slecht voor alle klanten."
 *
 * Cost: ~$0.0003 per call (Haiku 4.5, ~400 tokens in, ~100 tokens out).
 * Runs at insert time so the scope is on the row before the next
 * refresh / generate-image reads the feedback pool. Fails open: if
 * classification fails for any reason, we default to scope="client"
 * (safe — feedback stays scoped to this client only).
 */

const anthropic = new Anthropic()
const MODEL = "claude-haiku-4-5-20251001"
const MAX_TOKENS = 200

export type FeedbackScope = "client" | "global" | "both"

export type FeedbackScopeVerdict = {
  scope: FeedbackScope
  rationale: string
}

export type FeedbackClassifierInput = {
  feedbackText: string
  clientName?: string | null
  sector?: string | null
  /** Optional hint from caller about HOW the feedback arrived. Helps
   *  the classifier weigh signal strength — explicit text is stronger
   *  than an inferred prompt-edit diff. */
  feedbackType?: "explicit" | "prompt_edit" | "regen" | "upload"
}

const SYSTEM_PROMPT = `You are classifying Campaign Manager (CM) feedback on AI-generated Meta ad creatives for an agency called Rocket Leads.

Each piece of feedback must be sorted into a pool so the AI system (Pedro) knows whether to apply it to ONE specific client only or to ALL clients.

Three possible scopes:

- "client" — Specific to THIS client's brand, taste, audience, or industry. Would NOT apply to other clients. Examples:
  * "Logo van Zumex altijd klein"
  * "Klant haat stock-foto's met te witte tanden"
  * "Altijd minimaal 1 persoon in beeld voor deze klant"
  * "Geen mannen in beeld"
  * "Klant wil altijd Engelse headlines"

- "global" — A general craft / design / quality lesson that applies to ALL Rocket Leads creatives. Examples:
  * "Geen doorstreping op tekst — leest als ontkenning"
  * "Subjects groter in beeld — Meta-feed scan moment"
  * "Geen glow op letters — slechte leesbaarheid"
  * "Headlines moeten pijnpunt-vragen zijn"
  * "Te veel lege achtergrond = verspilde stopping-power"

- "both" — Started as a client-specific complaint but the underlying principle generalises. Save against this client AND in the global pool. Examples:
  * "Deze klant haat dat tekst glowed" → bare principle (geen glow op letters) is universal
  * "Klant vond personen te klein" → bare principle (subjects groter in beeld) is universal

Default lean: when the feedback could plausibly help other clients, lean toward "both" rather than "client". When it's clearly brand-specific (named entity, specific colour, specific industry constraint), stick to "client".

Output JSON ONLY in this exact shape, no markdown fences:
{"scope": "client" | "global" | "both", "rationale": "<one short sentence in Dutch explaining why>"}`

/** Classify CM feedback for Pedro's dual learning loop. Fails open to
 *  scope="client" so a classifier hiccup never blocks the CM's save
 *  flow and never accidentally elevates noise into the global pool.
 */
export async function classifyFeedbackScope(
  input: FeedbackClassifierInput,
): Promise<FeedbackScopeVerdict> {
  const text = input.feedbackText.trim()
  if (!text) {
    return { scope: "client", rationale: "Lege feedback — fallback naar client scope." }
  }

  const ctxLines: string[] = []
  if (input.clientName) ctxLines.push(`Client: ${input.clientName}`)
  if (input.sector) ctxLines.push(`Sector: ${input.sector}`)
  if (input.feedbackType) ctxLines.push(`Feedback type: ${input.feedbackType}`)
  const ctxBlock = ctxLines.length > 0 ? `${ctxLines.join("\n")}\n\n` : ""

  const userContent = `${ctxBlock}Feedback: "${text}"`

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    })

    const textPart = message.content.find(
      (part): part is Anthropic.TextBlock => part.type === "text",
    )
    if (!textPart) {
      return { scope: "client", rationale: "Classifier gaf geen text-output." }
    }

    const raw = textPart.text.trim()
    const parsed = extractJson(raw)
    if (!parsed) {
      return { scope: "client", rationale: "Classifier output niet parseerbaar." }
    }

    const scope = normaliseScope(parsed.scope)
    const rationale =
      typeof parsed.rationale === "string" && parsed.rationale.trim().length > 0
        ? parsed.rationale.trim().slice(0, 280)
        : "Geen rationale van classifier."
    return { scope, rationale }
  } catch (e) {
    console.error(
      "[pedro/feedback-scope-classifier] failed (fallback to client):",
      e instanceof Error ? e.message : e,
    )
    return { scope: "client", rationale: "Classifier-call mislukt, fallback naar client scope." }
  }
}

function normaliseScope(raw: unknown): FeedbackScope {
  if (raw === "global" || raw === "both" || raw === "client") return raw
  return "client"
}

function extractJson(raw: string): { scope?: unknown; rationale?: unknown } | null {
  // Tolerate code-fence wrappers in case the model ignores the
  // "no markdown" instruction.
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()
  try {
    const obj = JSON.parse(stripped)
    if (obj && typeof obj === "object") return obj as { scope?: unknown; rationale?: unknown }
    return null
  } catch {
    // Last-ditch: pluck the first JSON-looking substring.
    const start = stripped.indexOf("{")
    const end = stripped.lastIndexOf("}")
    if (start < 0 || end <= start) return null
    try {
      const obj = JSON.parse(stripped.slice(start, end + 1))
      if (obj && typeof obj === "object") return obj as { scope?: unknown; rationale?: unknown }
      return null
    } catch {
      return null
    }
  }
}
