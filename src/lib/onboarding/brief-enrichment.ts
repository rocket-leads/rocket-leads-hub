import Anthropic from "@anthropic-ai/sdk"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Brief enrichment for the onboarding wizard's Stap 3.
 *
 * Stap 1 (live kick-off) leaves us with the AM's live brief draft - what
 * they typed while talking to the client. Stap 2 (transcript link) wires
 * up the Fathom recording for that same call. Enrichment is the AI pass
 * that reads the full transcript and proposes additions / corrections to
 * each brief field, citing the transcript timestamp the suggestion came
 * from. The AM accepts or rejects per field.
 *
 * Distinct from Pedro's `generateAutoBrief` (lib/pedro/generate-brief.ts)
 * which generates a brief from scratch using Monday + Trengo + recent
 * meetings. Here we narrowly focus on "given X already filled, what does
 * the transcript ADD that the AM missed?" - different prompt, different
 * output shape (per-field deltas, not a complete brief).
 */

const anthropic = new Anthropic()

export type BriefFields =
  | "bedrijf"
  | "sector"
  | "websiteUrl"
  | "doelgroep"
  | "pijnpunten"
  | "aanbod"
  | "usps"
  | "marketingHooks"

export type BriefDraft = Record<BriefFields, string>

export type FieldSuggestion = {
  /** The AM's live-typed value (echoed back unchanged so the diff UI
   *  doesn't have to round-trip to Stap 1). */
  amValue: string
  /** What AI suggests adding to or replacing the AM's value. Empty
   *  string means "AI found nothing useful in the transcript for this
   *  field" - UI hides the suggestion row entirely in that case. */
  suggestion: string
  /** Short rationale citing transcript timestamps where possible so the
   *  AM can verify without re-reading the full transcript. */
  rationale: string
  /** AI's recommendation: 'add' (append to AM's existing text) or
   *  'replace' (the AM clearly got something wrong and AI saw the
   *  correction in transcript). Default 'add' when AM had nothing. */
  mode: "add" | "replace"
}

export type EnrichmentResult = {
  suggestions: Record<BriefFields, FieldSuggestion>
  /** Set when the transcript was too short / empty to be useful, so the
   *  UI can show a clear "no enrichment possible" state instead of an
   *  apparently-empty suggestions object. */
  insufficientTranscript: boolean
}

const SYSTEM_PROMPT = `You are an expert at extracting marketing-brief facts from kick-off meeting transcripts. The account manager just had the meeting and typed a quick brief live during the call. Your job: scan the FULL transcript and propose per-field additions or corrections to that live brief.

Rules:
- ONE JSON object back, no prose. The wrapper is { "suggestions": {...} }.
- One key per brief field: bedrijf, sector, websiteUrl, doelgroep, pijnpunten, aanbod, usps, marketingHooks.
- Per field, return { "suggestion": string, "rationale": string, "mode": "add" | "replace" }.
- "suggestion" = what to append (mode=add) OR what to fully replace the AM's value with (mode=replace).
- Empty "suggestion" = no useful addition found in transcript. Use this liberally - don't pad.
- "mode" defaults to "add". Use "replace" only when the AM clearly got a fact wrong and the client corrected it on the call.
- "rationale" = ONE short line. Reference the transcript timestamp like [00:14:22] when you can pinpoint where you got it. Skip rationale only when suggestion is empty.
- For marketingHooks: it's fine to propose 2-3 hooks as bullet points if the client gave you that much material.
- Don't invent facts the transcript doesn't support. If you're unsure, leave the suggestion empty.

Output schema (strict):
{
  "suggestions": {
    "bedrijf":       { "suggestion": string, "rationale"?: string, "mode": "add" | "replace" },
    "sector":        { "suggestion": string, "rationale"?: string, "mode": "add" | "replace" },
    "websiteUrl":    { "suggestion": string, "rationale"?: string, "mode": "add" | "replace" },
    "doelgroep":     { "suggestion": string, "rationale"?: string, "mode": "add" | "replace" },
    "pijnpunten":    { "suggestion": string, "rationale"?: string, "mode": "add" | "replace" },
    "aanbod":        { "suggestion": string, "rationale"?: string, "mode": "add" | "replace" },
    "usps":          { "suggestion": string, "rationale"?: string, "mode": "add" | "replace" },
    "marketingHooks":{ "suggestion": string, "rationale"?: string, "mode": "add" | "replace" }
  }
}`

const EMPTY_FIELDS: BriefDraft = {
  bedrijf: "",
  sector: "",
  websiteUrl: "",
  doelgroep: "",
  pijnpunten: "",
  aanbod: "",
  usps: "",
  marketingHooks: "",
}

const EMPTY_SUGGESTION: FieldSuggestion = {
  amValue: "",
  suggestion: "",
  rationale: "",
  mode: "add",
}

/**
 * Run the enrichment pass for one client.
 *
 * Loads:
 *   - AM's live brief draft from kickoff_live step content
 *   - Linked Fathom meeting's transcript (via the meeting_id captured by
 *     transcript_link step)
 *
 * Returns a per-field suggestion map. Caller (the API route) persists
 * the result into brief_enrichment step content; the UI renders the
 * accept/reject view from there.
 */
export async function enrichBriefFromTranscript(args: {
  mondayItemId: string
}): Promise<EnrichmentResult> {
  const supabase = await createAdminClient()

  // ── 1. Read both prior steps' content from client_onboarding_tasks ──
  const { data: rows } = await supabase
    .from("client_onboarding_tasks")
    .select("task_key, content, done")
    .eq("monday_item_id", args.mondayItemId)
    .in("task_key", ["kickoff_live", "transcript_link"])

  const kickoffRow = rows?.find((r) => r.task_key === "kickoff_live")
  const transcriptRow = rows?.find((r) => r.task_key === "transcript_link")

  const briefDraft: BriefDraft = mergeBriefDraft(
    (kickoffRow?.content as { briefDraft?: Partial<BriefDraft> } | null)?.briefDraft,
  )
  const meetingId = (transcriptRow?.content as { meetingId?: string } | null)?.meetingId

  if (!meetingId) {
    // Stap 2 not done yet - can't enrich without a linked transcript.
    return {
      suggestions: blankSuggestions(briefDraft),
      insufficientTranscript: true,
    }
  }

  // ── 2. Pull the transcript ──
  const { data: meeting } = await supabase
    .from("meetings")
    .select("transcript, summary, title")
    .eq("id", meetingId)
    .single()

  const transcript = (meeting?.transcript ?? "").trim()
  if (transcript.length < 300) {
    // Fathom sometimes ships before the transcript fully renders - wait
    // and try again rather than show a misleading "AI found nothing".
    return {
      suggestions: blankSuggestions(briefDraft),
      insufficientTranscript: true,
    }
  }

  // ── 3. Ask Claude ──
  const userPrompt = `KICK-OFF TRANSCRIPT (${meeting?.title ?? "untitled"}):
${transcript}

---

AM's LIVE BRIEF (typed during the call - may be incomplete):
${formatBriefForPrompt(briefDraft)}

Propose per-field additions or corrections based on what the transcript reveals beyond the AM's live notes.`

  let raw = ""
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    })
    raw = message.content[0]?.type === "text" ? message.content[0].text : ""
  } catch (e) {
    throw new Error(
      `AI enrichment failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  const cleaned = raw.replace(/```json|```/g, "").trim()
  let parsed: { suggestions?: Partial<Record<BriefFields, Partial<FieldSuggestion>>> }
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error("AI gaf een ongeldig JSON-antwoord terug bij enrichment.")
  }

  // Stitch AI output back together with AM's values, filling defaults
  // for any field the model dropped (rare but defensive).
  const suggestions = {} as Record<BriefFields, FieldSuggestion>
  for (const field of Object.keys(briefDraft) as BriefFields[]) {
    const ai = parsed.suggestions?.[field] ?? {}
    suggestions[field] = {
      amValue: briefDraft[field],
      suggestion: typeof ai.suggestion === "string" ? ai.suggestion.trim() : "",
      rationale: typeof ai.rationale === "string" ? ai.rationale.trim() : "",
      mode: ai.mode === "replace" ? "replace" : "add",
    }
  }

  return { suggestions, insufficientTranscript: false }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function mergeBriefDraft(partial: Partial<BriefDraft> | undefined): BriefDraft {
  return { ...EMPTY_FIELDS, ...(partial ?? {}) }
}

function blankSuggestions(amBrief: BriefDraft): Record<BriefFields, FieldSuggestion> {
  const out = {} as Record<BriefFields, FieldSuggestion>
  for (const field of Object.keys(amBrief) as BriefFields[]) {
    out[field] = { ...EMPTY_SUGGESTION, amValue: amBrief[field] }
  }
  return out
}

function formatBriefForPrompt(draft: BriefDraft): string {
  return (Object.entries(draft) as Array<[BriefFields, string]>)
    .map(([field, value]) => `- ${field}: ${value || "(blank)"}`)
    .join("\n")
}
