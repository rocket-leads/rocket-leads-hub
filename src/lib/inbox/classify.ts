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

const CONFIDENCE_FLOOR = 0.85

const SYSTEM_PROMPT = `You classify workplace inbox messages into ONE of: "chat", "task", or "update".

GROUND RULES
- DEFAULT IS CHAT. Most messages are chat. The bar for "task" or "update" is HIGH — only promote when the case is overwhelming.
- Messages from CLIENTS are ALWAYS chat. A client asking a question, sharing info, complaining, or making a request is conversation that needs human judgment, not a Hub task. The AM decides whether to commit to action — that decision generates a task only when the AM explicitly states it.
- Messages from RL_TEAM (the agency's own team) can be task or update IF AND ONLY IF they meet the strict tests below.

CRITICAL DISTINCTION — TASK vs UPDATE
The same message about the same client can read as either, depending on tense and intent. Use this rule:
  - TASK = something STILL HAS TO HAPPEN. There is unfinished action, and a specific person is the one who needs to do it. Look for imperative verbs, hand-offs, "to do" markers, future-tense commitments, or questions that demand work ("kun je…?", "wil je even…?", "check je…?").
  - UPDATE = something HAS ALREADY HAPPENED or is currently in a stable state. Past tense, status reports, FYI announcements. Nobody needs to act on this; the team just needs to know it.
If the message is an @mention with no clear action verb directed at the mentioned person → UPDATE (they're being kept in the loop, not asked to do something).
If the message is a hand-off ("@X kun je dit oppakken?", "@X TO DO …", "@X regel jij dat?") → TASK.
If the message is past-tense status ("@X klant heeft getekend", "@X campagne staat live") → UPDATE.

CATEGORIES
- "chat": all conversational messages. Greetings, replies, questions, complaints, social chitchat, short notes, ambient communication. The default for everything that isn't unmistakably one of the others.
- "task": Either (a) an explicit hand-off via @mention with an action verb directed at the mentioned person, OR (b) a first-person commitment by the author to do something concrete ("ik ga X doen", "I'll send Y by Friday"). Examples that DO qualify:
    "Ik ga vanmiddag de creatives uploaden"
    "I'll send the proposal by end of day"
    "Morgen bel ik X om dat te regelen"
    "@Stefan kun je deze koppeling checken?"
    "@Roy TO DO contact opnemen met klant X"
    "@Danny regel jij de campagne setup voor donderdag?"
  Examples that DO NOT qualify (these are UPDATE or CHAT):
    Anything from a client → chat
    Vague intent like "ik kijk er even naar" → chat (no concrete action)
    "@Stefan klant heeft contract getekend" → update (past tense, FYI)
    "@Roy campagne staat live sinds 09:00" → update (status report)
    "@Stefan we hebben hier de uitnodiging ontvangen" → update (status share with no ask)
    Questions or greetings without commitment → chat
- "update": a substantive status share from RL_TEAM that the team should KNOW but doesn't need to ACT on. Examples:
    "Klant heeft het contract getekend"
    "Ad account is back online na de Meta restrictie"
    "Campaign Y staat live sinds 09:00"
    "@Stefan onboarding deze klant is afgerond"
    "@Roy de creatives staan klaar in Drive"

DECISION ORDER
1. AUTHOR is "client" or "external" → "chat". No exceptions, no matter what they ask. Confidence 1.0.
2. Past-tense status report or FYI without unfinished action → "update".
3. @mention with imperative/question/TO-DO directed at the mentioned person → "task".
4. First-person commitment "ik ga / I'll" with concrete action → "task".
5. Anything else → "chat" with low confidence.

When in doubt between task and update, prefer UPDATE. False-positive tasks add noise; missed tasks are still visible in updates.

OUTPUT
Return ONLY JSON, no prose:
{ "kind": "chat" | "task" | "update", "confidence": 0..1, "reason": "<one short sentence>" }`

/**
 * Classify a single incoming inbox message. Defaults to "chat" on any kind of
 * uncertainty — false positives in task/update are noisier than missing a
 * borderline case (which still lands in the chat substrate anyway).
 *
 * Roy's rule: client messages are ALWAYS chat. Tasks emerge from team
 * commitment, not from client requests. We hard-branch on `authorKind` and
 * skip the LLM entirely for client/external — saves cost + latency, and
 * removes any chance of the model promoting a client question to a task.
 *
 * Confidence below CONFIDENCE_FLOOR (0.85) falls back to "chat" — the bar
 * for promotion is intentionally high.
 */
export async function classifyInboxMessage(input: ClassifyInput): Promise<ClassifyOutput> {
  // Hard short-circuit: client/external messages don't generate tasks. The
  // AM creates a task by committing to action in their own reply or note.
  if (input.authorKind !== "rl_team") {
    return {
      kind: "chat",
      confidence: 1,
      reason: "client/external message — chat by default",
    }
  }

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
