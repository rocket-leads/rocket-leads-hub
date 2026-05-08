import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchClientById, fetchItemUpdates } from "@/lib/integrations/monday"
import { fetchConversations, fetchMessages } from "@/lib/integrations/trengo"
import { loadPedroSystemPrompt } from "@/lib/pedro/knowledge"
import { pastContextForStage } from "@/lib/pedro/past-campaigns"

/**
 * Pedro's auto-brief generator. Same logic that powers /api/pedro/auto-brief
 * extracted into a lib function so it can be called from:
 *  - the route handler (CM clicks "AI auto-fill")
 *  - the kick-off auto-trigger (Fathom webhook → Pedro pre-drafts the brief)
 *  - any future cron / batch job
 *
 * Anthropic SDK reads ANTHROPIC_API_KEY from env. Failures bubble up to the
 * caller — caller decides whether to surface or swallow them.
 */

const anthropic = new Anthropic()

export type GeneratedBrief = {
  bedrijf: string
  sector: string
  doelgroep: string
  pijnpunten: string
  aanbod: string
  usps: string
  marketingHooks: string
  websiteUrl: string
  driveLink: string
  /** Short, plain-text rationale ("based on kick-off + last eval"). */
  source: string
}

export type GenerateBriefMeta = {
  hasKickoffUpdate: boolean
  hasLatestEval: boolean
  hasKickoffMeeting: boolean
  monthlyUpdateCount: number
  hasTrengo: boolean
  /** Monday item id used as input — echo for callers that need provenance. */
  clientId: string
  /** Display name resolved from Monday item. */
  clientName: string
}

const EMPTY: GeneratedBrief = {
  bedrijf: "",
  sector: "",
  doelgroep: "",
  pijnpunten: "",
  aanbod: "",
  usps: "",
  marketingHooks: "",
  websiteUrl: "",
  driveLink: "",
  source: "",
}

function trim(s: string, max: number): string {
  if (!s) return ""
  if (s.length <= max) return s
  return s.slice(0, max) + "…"
}

export async function generateAutoBrief(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ brief: GeneratedBrief; meta: GenerateBriefMeta }> {
  if (!clientId) throw new Error("clientId is verplicht")

  // ── 1. Pull Monday client + recent updates in parallel ──
  const [client, updates] = await Promise.all([
    fetchClientById(clientId).catch(() => null),
    fetchItemUpdates(clientId, 90).catch(() => []),
  ])

  if (!client) throw new Error("Klant niet gevonden in Monday")

  // ── 2. Pull recent meetings — most recent EVALUATION wins, kick-off is anchor ──
  const { data: meetingsRaw } = await supabase
    .from("meetings")
    .select("id, title, scheduled_at, meeting_type, summary, transcript")
    .eq("client_id", clientId)
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .limit(20)

  const meetings = (meetingsRaw ?? []) as Array<{
    id: string
    title: string | null
    scheduled_at: string | null
    meeting_type: string | null
    summary: string | null
    transcript: string | null
  }>

  const latestEval = meetings.find((m) => m.meeting_type === "evaluation") ?? null
  const latestKickoff = meetings.find((m) => m.meeting_type === "kick_off") ?? null
  const otherRecent =
    meetings.find(
      (m) =>
        m.meeting_type !== "evaluation" &&
        m.meeting_type !== "kick_off" &&
        m.meeting_type !== "internal",
    ) ?? null

  // ── 3. Pull Trengo recent client messages (last 90d) ──
  let trengoSnippet = ""
  if (client.trengoContactId) {
    try {
      const convs = await fetchConversations(client.trengoContactId)
      const recent = convs.slice(0, 5)
      const messageBlocks: string[] = []
      for (const c of recent) {
        try {
          const msgs = await fetchMessages(c.id)
          const tail = msgs.slice(-6).map((m) => {
            const body = (m.body ?? "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
            return `[${m.created_at?.slice(0, 10) ?? ""}] ${m.type === "INBOUND" ? "Klant" : "RL"}: ${trim(body, 240)}`
          })
          if (tail.length > 0) messageBlocks.push(tail.join("\n"))
        } catch {
          /* skip per-conversation failure */
        }
      }
      trengoSnippet = messageBlocks.slice(0, 3).join("\n---\n")
    } catch {
      trengoSnippet = ""
    }
  }

  // ── 4. Find kick-off update (anchor context) ──
  const kickoffUpdate = updates.find(
    (u) => u.text.includes("KICK-OFF") || u.text.includes("Company name:"),
  )
  const recentUpdates = updates
    .filter((u) => u !== kickoffUpdate)
    .slice(0, 8)
    .map((u) => `[${u.createdAt}] ${u.creatorName}: ${trim(u.text, 320)}`)
    .join("\n")

  // ── 5. Compose the prompt ──
  const sections: string[] = [
    `KLANT: ${client.companyName || client.name} (Monday item ${client.mondayItemId}, board: ${client.boardType})`,
    `Account manager: ${client.accountManager || "-"} | Campaign manager: ${client.campaignManager || "-"} | Status: ${client.campaignStatus || "-"}`,
  ]

  if (kickoffUpdate) {
    sections.push(`\n[KICK-OFF update — ${kickoffUpdate.createdAt}]\n${trim(kickoffUpdate.text, 4500)}`)
  }
  if (latestEval) {
    sections.push(
      `\n[MEEST RECENTE EVALUATIE — ${latestEval.scheduled_at?.slice(0, 10) ?? ""}, "${latestEval.title ?? ""}"]\n` +
        `Samenvatting: ${trim(latestEval.summary ?? "", 1200)}\n` +
        (latestEval.transcript ? `Transcript: ${trim(latestEval.transcript, 6000)}` : ""),
    )
  }
  if (latestKickoff && latestKickoff.id !== latestEval?.id) {
    sections.push(
      `\n[KICK-OFF MEETING — ${latestKickoff.scheduled_at?.slice(0, 10) ?? ""}]\n` +
        `Samenvatting: ${trim(latestKickoff.summary ?? "", 1200)}\n` +
        (latestKickoff.transcript ? `Transcript: ${trim(latestKickoff.transcript, 10000)}` : ""),
    )
  }
  if (otherRecent) {
    sections.push(
      `\n[ANDERE RECENTE MEETING — ${otherRecent.scheduled_at?.slice(0, 10) ?? ""}, "${otherRecent.title ?? ""}"]\n` +
        `Samenvatting: ${trim(otherRecent.summary ?? "", 600)}`,
    )
  }
  if (recentUpdates) {
    sections.push(`\n[RECENTE MONDAY UPDATES (laatste 90d)]\n${recentUpdates}`)
  }
  if (trengoSnippet) {
    sections.push(`\n[RECENTE TRENGO BERICHTEN]\n${trim(trengoSnippet, 2500)}`)
  }

  const pastBrief = await pastContextForStage(clientId, "brief", 2)

  const prompt = `Op basis van onderstaande klantcontext, vul een complete campagne-brief in voor deze klant. Pedro gebruikt deze brief als basis voor angles, scripts en creatives — wees zo specifiek en bruikbaar mogelijk.

BELANGRIJKE PRIORITEITSREGELS:
1. **De MEEST RECENTE evaluatie weegt het zwaarst.** Als er recente eval-context is, is die leidend boven de kick-off. Doelgroep, propositie en aanbod kunnen sinds de kick-off zijn aangepast — pak de actuele versie.
2. **Negeer expliciet tegenstrijdige info uit oude meetings of updates** — als de huidige eval iets anders zegt dan de kick-off, ga met de eval mee. Geen ruis op de lijn.
3. Trengo-berichten en recente Monday updates zijn aanvullende signalen voor pijn, bezwaren en wat klant nu echt wil — niet de hoofdbron.
4. Kick-off blijft de baseline voor sector, USP's en aanbod-structuur als er géén recentere eval is.

${sections.join("\n")}
${pastBrief}
Geef alleen JSON terug (geen markdown, geen code fences), exact in dit format:

{
  "bedrijf": "Officiele bedrijfsnaam",
  "sector": "Branche / sector zoals Pedro die zou positioneren (bv. 'Verduurzaming - zonnepanelen', 'Renovatie - badkamers')",
  "doelgroep": "Concrete ICP omschrijving — B2B/B2C, regio, demografie, koopkracht. 1-2 zinnen.",
  "pijnpunten": "De 2-3 belangrijkste pijnpunten van de doelgroep, vanuit klant-perspectief. Als bullets met '-'.",
  "aanbod": "Het aanbod / dienst, inclusief tarieven of prijsindicatie als die bekend zijn. 1-3 zinnen.",
  "usps": "De 3-5 sterkste USP's van de klant. Als bullets met '-'.",
  "marketingHooks": "Bestaande hooks die in de kick-off / evaluatie zijn benoemd door account manager (niet jij verzinnen, alleen extracten als ze er zijn). Lege string als er geen hooks zijn benoemd.",
  "websiteUrl": "Website URL van klant (bv. www.bedrijfsnaam.nl) — alleen als deze in de context voorkomt, anders lege string",
  "driveLink": "Google Drive folder link — alleen als die in de context voorkomt, anders lege string",
  "source": "1 zin in NL die kort uitlegt waar je deze brief op hebt gebaseerd, bv. 'Op basis van laatste evaluatie 2026-04-12 + kick-off + 8 recente Monday updates.'"
}

Belangrijk:
- Alle tekst in het Nederlands
- Geen platte herhaling — synthetiseer; haal de essentie uit context
- Lege string ('') voor velden waar geen betrouwbare info beschikbaar is, NIET fantaseren
- Geen datums of deadlines in de brief tenzij die expliciet in de context staan`

  // ── 6. Call Claude ──
  const system = await loadPedroSystemPrompt()
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2200,
    system,
    messages: [{ role: "user", content: prompt }],
  })
  const raw = message.content[0]?.type === "text" ? message.content[0].text : ""

  // ── 7. Parse JSON ──
  const cleaned = raw.replace(/```json|```/g, "").trim()
  let parsed: Partial<GeneratedBrief>
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error("Pedro gaf een ongeldig antwoord terug. Probeer opnieuw.")
  }

  const brief: GeneratedBrief = {
    ...EMPTY,
    ...parsed,
    bedrijf: (parsed.bedrijf || client.companyName || client.name || "").trim(),
  }

  return {
    brief,
    meta: {
      hasKickoffUpdate: Boolean(kickoffUpdate),
      hasLatestEval: Boolean(latestEval),
      hasKickoffMeeting: Boolean(latestKickoff && latestKickoff.id !== latestEval?.id),
      monthlyUpdateCount: updates.length,
      hasTrengo: Boolean(trengoSnippet),
      clientId,
      clientName: client.companyName || client.name,
    },
  }
}
