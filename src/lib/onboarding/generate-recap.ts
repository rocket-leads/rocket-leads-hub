import Anthropic from "@anthropic-ai/sdk"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchClientById } from "@/lib/integrations/monday"
import { buildRecapFallback } from "./recap-template"

/**
 * Generate a post-kick-off recap email from the Fathom transcript.
 *
 * AI reads the linked kick-off transcript + a thin context layer
 * (klant name, AM name, Drive URL, Meta BM URL) and writes a concise
 * recap email in Roy's voice. Roy 2026-06-11 brief:
 *   - opening: "Tof dat we van start gaan!" + groei-belofte
 *   - 2-3 zinnen recap van wat besproken is (uit transcript)
 *   - actiepunten ALS die in transcript besproken zijn — wat wij doen,
 *     wat zij doen, wanneer we terugkomen. Geen vaste lijstjes.
 *   - Drive + Meta link
 *   - closer + sign-off
 *   - tone: beknopt, simpel, straight to the point
 *
 * Falls back to `buildRecapFallback` when no transcript is linked or
 * the transcript is too short to be useful.
 */

const anthropic = new Anthropic()

export type RecapContext = {
  mondayItemId: string
  driveFolderUrl?: string | null
  metaBmConnectUrl?: string | null
}

export type RecapResult = {
  body: string
  /** Where the body came from — useful for the UI to show whether the
   *  AM should expect to fill in placeholders or whether the AI did
   *  the heavy lifting. */
  source: "ai_from_transcript" | "fallback_no_transcript" | "fallback_short_transcript"
}

const SYSTEM_PROMPT = `Je bent Roy Vosters, eigenaar van Rocket Leads — een Nederlandse performance marketing agency. Je schrijft een korte, persoonlijke recap-mail naar een nieuwe klant direct na hun kick-off meeting.

Tone-of-voice (Rocket Leads):
- Direct, zelfverzekerd, vriendelijk
- Korte zinnen, conversationeel
- Jij/jou, niet u
- Geen corporaat, geen fluff
- Enthousiast over de samenwerking maar zonder overdrijven

Structuur (HOUD HET KORT):
1. Persoonlijke groet + 1 zin "Tof dat we van start gaan + groei-belofte voor hun bedrijf"
2. 2-3 zinnen recap van wat besproken is — pak de belangrijkste punten uit het transcript (doelgroep, propositie, doelen, eventuele specifieke verzoeken/zorgen)
3. ALS in het transcript actiepunten genoemd zijn:
   - Wat wij gaan doen (kort, geen bullets als het 1-2 dingen zijn)
   - Wat zij gaan doen
   - Wanneer we terugkomen (datum/tijd als genoemd in transcript)
   Geen vaste lijstjes met emoji's — schrijf als een mens.
4. Drive folder + Meta BM link op aparte regels (gewone tekst, geen markdown)
5. Closer: "Vragen of loop je ergens tegenaan? Laat het direct weten."
6. Sign-off: "Groet, {AM-naam}"

Regels:
- NIET letterlijk uit transcript citeren — herformuleer naar nette mailtaal
- GEEN pakket-prijzen, GEEN contractuele zaken, GEEN "wij leveren X service voor Y euro"
- ALS transcript geen specifieke actiepunten heeft, sla die paragraaf over
- ALS geen datum/tijd voor volgende touchpoint genoemd is, schrijf "Ik kom binnenkort even bij je terug" of laat weg
- Markdown / emoji's: alleen 📂 en 🔗 voor Drive en Meta resp.
- Plain text output — geen ** of __

Output: alleen de email body. Geen meta-commentaar, geen "hier is je mail:", geen quotes eromheen.`

export async function generateRecapFromTranscript(
  ctx: RecapContext,
): Promise<RecapResult> {
  // ── Pull klant snapshot (firstName, companyName, AM name) ──
  const client = await fetchClientById(ctx.mondayItemId).catch(() => null)
  if (!client) {
    throw new Error("Client not found in Monday")
  }
  const fallbackInput = {
    firstName: client.firstName || client.name,
    companyName: client.companyName || client.name,
    amName: client.accountManager,
    driveFolderUrl: ctx.driveFolderUrl,
    metaBmConnectUrl: ctx.metaBmConnectUrl,
  }

  // ── Find the linked kick-off transcript ──
  const supabase = await createAdminClient()
  const { data: transcriptRow } = await supabase
    .from("client_onboarding_tasks")
    .select("content")
    .eq("monday_item_id", ctx.mondayItemId)
    .eq("task_key", "transcript_link")
    .maybeSingle()

  const meetingId = (transcriptRow?.content as { meetingId?: string } | null)?.meetingId
  if (!meetingId) {
    return {
      body: buildRecapFallback(fallbackInput),
      source: "fallback_no_transcript",
    }
  }

  const { data: meeting } = await supabase
    .from("meetings")
    .select("transcript, summary, title")
    .eq("id", meetingId)
    .single()

  const transcript = (meeting?.transcript ?? "").trim()
  // Sub-300-char transcripts usually mean Fathom shipped the meeting
  // metadata before the actual transcription job finished. AI would
  // hallucinate the recap; fall back to manual.
  if (transcript.length < 300) {
    return {
      body: buildRecapFallback(fallbackInput),
      source: "fallback_short_transcript",
    }
  }

  // ── Ask Claude ──
  const userPrompt = `KICK-OFF TRANSCRIPT (${meeting?.title ?? "untitled"}):
${transcript}

---

CONTEXT:
- Klant voornaam: ${client.firstName || "(onbekend)"}
- Bedrijfsnaam: ${client.companyName || client.name}
- AM voornaam: ${client.accountManager || "(onbekend)"}
- Drive folder URL: ${ctx.driveFolderUrl || "(niet beschikbaar)"}
- Meta BM uitleg URL: ${ctx.metaBmConnectUrl || "(niet beschikbaar)"}

Schrijf de recap-email. Beknopt, persoonlijk, straight to the point.`

  let raw = ""
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    })
    raw = message.content[0]?.type === "text" ? message.content[0].text : ""
  } catch (e) {
    throw new Error(
      `AI recap generation failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  // Trim any accidental markdown / leading "Here is the email:" prelude
  // — the system prompt forbids it but defensively strip anyway.
  const body = raw
    .replace(/^(here is.*?email.*?:|hier is.*?:|recap.*?:)/i, "")
    .trim()

  return { body, source: "ai_from_transcript" }
}
