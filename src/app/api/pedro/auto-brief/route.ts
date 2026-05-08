import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchClientById, fetchItemUpdates } from "@/lib/integrations/monday"
import { fetchConversations, fetchMessages } from "@/lib/integrations/trengo"
import { loadPedroSystemPrompt } from "@/lib/pedro/knowledge"
import { pastContextForStage } from "@/lib/pedro/past-campaigns"

const anthropic = new Anthropic()

type BriefOutput = {
  bedrijf: string
  sector: string
  doelgroep: string
  pijnpunten: string
  aanbod: string
  usps: string
  marketingHooks: string
  websiteUrl: string
  driveLink: string
  /** Short, plain-text rationale ("based on kick-off + last eval"). Surfaced to the AM. */
  source: string
}

const EMPTY: BriefOutput = {
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

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let clientId: string
  try {
    const body = await req.json()
    clientId = String(body.clientId ?? "")
    if (!clientId) {
      return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // ── 1. Pull Monday client + recent updates in parallel ──
  const supabase = await createAdminClient()
  const [client, updates] = await Promise.all([
    fetchClientById(clientId).catch(() => null),
    fetchItemUpdates(clientId, 90).catch(() => []),
  ])

  if (!client) {
    return NextResponse.json({ error: "Klant niet gevonden in Monday" }, { status: 404 })
  }

  // ── 2. Pull recent meetings — prioritize most recent EVALUATION, then kick-off ──
  // Roy's rule: most recent eval > older evals (avoid stale conflicting context).
  // We send: 1 most recent eval + 1 kick-off + up to 1 other.
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
  const otherRecent = meetings.find(
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
          // Take last 6 messages, strip HTML, keep short
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

  // ── 4. Find kick-off update from Monday updates (used as anchor context) ──
  const kickoffUpdate = updates.find(
    (u) => u.text.includes("KICK-OFF") || u.text.includes("Company name:"),
  )
  const recentUpdates = updates
    .filter((u) => u !== kickoffUpdate)
    .slice(0, 8)
    .map((u) => `[${u.createdAt}] ${u.creatorName}: ${trim(u.text, 320)}`)
    .join("\n")

  // ── 5. Compose the prompt ──
  // Prioritisation rules baked into the prompt: latest eval > kick-off >
  // older context. Trengo + recent updates are fine-tuning signals.
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
    // Kick-off is the canonical source of truth for sector / ICP / aanbod
    // when there's no recent eval — keep this window generous (~10k chars
    // ≈ first 30-40 minutes of conversation, where the discovery happens).
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

  // Past Pedro campaigns for this client — brief context. Empty for first campaign.
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
  let raw = ""
  try {
    const system = await loadPedroSystemPrompt()
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2200,
      system,
      messages: [{ role: "user", content: prompt }],
    })
    raw = message.content[0]?.type === "text" ? message.content[0].text : ""
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Claude API fout"
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // ── 7. Parse JSON, return brief ──
  const cleaned = raw.replace(/```json|```/g, "").trim()
  let parsed: Partial<BriefOutput>
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return NextResponse.json(
      { error: "Pedro gaf een ongeldig antwoord terug. Probeer opnieuw.", raw: cleaned.slice(0, 500) },
      { status: 500 },
    )
  }

  const brief: BriefOutput = {
    ...EMPTY,
    ...parsed,
    bedrijf: (parsed.bedrijf || client.companyName || client.name || "").trim(),
  }

  return NextResponse.json({
    brief,
    meta: {
      hasKickoffUpdate: Boolean(kickoffUpdate),
      hasLatestEval: Boolean(latestEval),
      hasKickoffMeeting: Boolean(latestKickoff && latestKickoff.id !== latestEval?.id),
      monthlyUpdateCount: updates.length,
      hasTrengo: Boolean(trengoSnippet),
    },
  })
}
