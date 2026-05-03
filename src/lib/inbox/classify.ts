import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic()

export type ClassifyInput = {
  source: "trengo" | "slack" | "monday"
  authorKind: "rl_team" | "client" | "external"
  content: string
  /** Optional last few messages from the same thread, joined with newlines.
   *  Helps the model decide whether a short message is just chat or a task. */
  threadContext?: string
}

export type ClassifyOutput = {
  kind: "chat" | "task" | "update"
  confidence: number // 0..1
  reason: string
}

const CONFIDENCE_FLOOR = 0.6

const SYSTEM_PROMPT = `You classify incoming messages in a workplace inbox into ONE of three categories.

CATEGORIES
- "chat": ambient conversational message — greetings, replies, social chitchat, short questions that are just part of a flowing conversation, FYI of no immediate consequence. THIS IS THE DEFAULT. When in any doubt → chat.
- "task": EXPLICIT or IMPLICIT action requested with a (soft) deadline. Examples:
    "kun je morgen even bellen met X?"
    "graag voor vrijdag de creatives uploaden"
    "review deze ad copy please"
    "kan jij dit oppakken?"
- "update": discrete FYI / status share that the recipient should KNOW but doesn't need to ACT on. The thing being shared has informational weight beyond chitchat. Examples:
    "Net Sinovo gebeld, ze zijn enthousiast — gaan met ons door"
    "Ad account is back online na de Meta restrictie"
    "Klant heeft het contract getekend"
    "Campaign Y staat live sinds 09:00"

DECISION RULES (read in order)
1. If unclear or borderline → "chat". Prefer chat over false-positive promotion.
2. A short reply, greeting, or social message → "chat".
3. A question that just asks for info ("hoe gaat het?", "weet jij of...") → "chat" (it's a conversation, not an action item).
4. A status share with concrete substance → "update".
5. An action request, even soft ("zou je..."), with implicit deadline → "task".

OUTPUT
Return ONLY JSON, no prose:
{ "kind": "chat" | "task" | "update", "confidence": 0..1, "reason": "<one short sentence>" }`

/**
 * Classify a single incoming inbox message. Defaults to "chat" on any kind of
 * uncertainty — false positives in task/update are noisier than missing a
 * borderline case (which still lands in the chat substrate anyway).
 *
 * Confidence below 0.6 also falls back to "chat" — the AI itself signals
 * uncertainty and we trust that signal.
 */
export async function classifyInboxMessage(input: ClassifyInput): Promise<ClassifyOutput> {
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            `SOURCE: ${input.source}`,
            `AUTHOR: ${input.authorKind}`,
            input.threadContext ? `\nRECENT THREAD:\n${input.threadContext}` : "",
            `\nMESSAGE:\n${input.content}`,
            `\nClassify into: chat, task, update. JSON only.`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    })

    const text = msg.content[0]?.type === "text" ? msg.content[0].text : ""
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { kind: "chat", confidence: 0.5, reason: "classifier returned no JSON" }
    }

    const parsed = JSON.parse(jsonMatch[0]) as Partial<ClassifyOutput>
    const rawKind = parsed.kind
    const kind: ClassifyOutput["kind"] =
      rawKind === "task" || rawKind === "update" ? rawKind : "chat"
    const confidence =
      typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5
    const reason = typeof parsed.reason === "string" ? parsed.reason : ""

    // Confidence floor: even if AI says "task" with low confidence, we'd
    // rather miss the promotion than create a noisy false-positive task.
    if (kind !== "chat" && confidence < CONFIDENCE_FLOOR) {
      return {
        kind: "chat",
        confidence,
        reason: `low confidence (${confidence.toFixed(2)}) → chat fallback. Original: ${reason}`,
      }
    }

    return { kind, confidence, reason }
  } catch (e) {
    console.error("Inbox classifier error:", e instanceof Error ? e.message : e)
    return { kind: "chat", confidence: 0, reason: "classifier failed" }
  }
}
