import { auth } from "@/lib/auth"
import { readCache, writeCache } from "@/lib/cache"
import type { ClientContext } from "@/lib/watchlist/collect-context"
import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"

const anthropic = new Anthropic()

type ClientInput = {
  id: string
  name: string
  category: "action" | "watch" | "good"
  issue: string
  adSpend: number
  leads: number
  cpl: number
  prevCpl: number
  appointments: number
  costPerAppointment: number
  prevCostPerAppointment: number
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { clients } = (await req.json()) as { clients: ClientInput[] }
  if (!clients?.length) return NextResponse.json({})

  // Check note cache
  const cached = await readCache<Record<string, string>>("watchlist_summaries_v3")

  const needed = clients.filter((c) => !cached?.[c.id])
  if (needed.length === 0 && cached) {
    const result: Record<string, string> = {}
    for (const c of clients) {
      if (cached[c.id]) result[c.id] = cached[c.id]
    }
    return NextResponse.json(result)
  }

  // Load enriched context (Monday updates + Trengo conversations)
  const contextCache = await readCache<Record<string, ClientContext>>("watchlist_context") ?? {}

  // Build prompt with qualitative + quantitative data
  const allClients = clients.slice(0, 50)
  const lines = allClients.map((c) => {
    const cplChange = c.prevCpl > 0 ? ((c.cpl - c.prevCpl) / c.prevCpl * 100).toFixed(0) : "n/a"
    const cpaChange = c.prevCostPerAppointment > 0 ? ((c.costPerAppointment - c.prevCostPerAppointment) / c.prevCostPerAppointment * 100).toFixed(0) : "n/a"

    const parts = [
      `[CLIENT ${c.id}] ${c.name} | ${c.category.toUpperCase()} | ${c.issue}`,
      `KPIs (7d): spend €${c.adSpend.toFixed(0)} | leads ${c.leads} | CPL €${c.cpl.toFixed(2)} (${cplChange}% wow) | appts ${c.appointments} | CPA €${c.costPerAppointment.toFixed(0)} (${cpaChange}% wow)`,
    ]

    const ctx = contextCache[c.id]
    if (ctx?.mondayUpdates) {
      parts.push(`MONDAY CRM:\n${ctx.mondayUpdates.slice(0, 800)}`)
    }
    if (ctx?.trengoSummary) {
      parts.push(`TRENGO CONVERSATIONS:\n${ctx.trengoSummary.slice(0, 800)}`)
    }
    if (!ctx?.mondayUpdates && !ctx?.trengoSummary) {
      parts.push(`(No qualitative data available — KPI only)`)
    }

    return parts.join("\n")
  }).join("\n\n---\n\n")

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      system: `You are a senior campaign manager at Rocket Leads, a Dutch lead generation agency. Generate a 1-line actionable note for each client.

## DATA PRIORITY (follow this order strictly)
1. **MONDAY CRM UPDATES** (highest signal) — Account manager and appointment setter notes about lead quality, client feedback, follow-up status. This is ground truth from the people doing the work daily.
2. **TRENGO CONVERSATIONS** (second signal) — Direct client messages showing satisfaction, complaints, lead quality feedback, requests. Read both CLIENT and RL messages for full context.
3. **KPI DATA** (supporting signal) — Numbers are often incomplete or inaccurate. Use as supporting evidence, never as the sole basis for a recommendation.

## CRITICAL PRINCIPLES
- Rocket Leads clients have FIXED, LIMITED budgets (€1,000–€3,000/month). NEVER recommend budget increases or scaling.
- NEVER recommend "keep running" or "maintain current approach" — that's passive. Winners decay from ad fatigue. Always recommend iterating: new variants of the winning creative.
- DON'T blindly trust client complaints. Apply RL's own experience:
  - "Leads nemen niet op" (leads don't pick up) → optimization point: adjust follow-up timing, add reminder sequences, try different call times — NOT a campaign problem
  - "Leads hebben geen budget" → real qualification issue: add budget question to form, adjust targeting
  - "Leads zijn niet geïnteresseerd" → check if creative/angle attracts wrong audience, or if follow-up is too slow
  - "Kwaliteit is slecht" → vague complaint, dig into specifics: which UTM, which ads, what % is actually bad?
- When AM notes mention specific issues → that IS the note
- When Trengo shows back-and-forth about an issue → summarize the actual problem and the RL-recommended fix

## RULES
- For ACTION: specific action to take (pause ads, test new angle, fix landing page, adjust targeting, improve follow-up sequence)
- For WATCH: what to monitor and when to act
- For GOOD: what's working and how to iterate on the winner (new creative variants, prep next angle)
- Reference actual context: quote Monday notes or Trengo feedback when relevant
- Keep each note under 22 words. Be direct, no fluff.
- Write in English

Output JSON only: {"client_id": "note", ...}`,
      messages: [{
        role: "user",
        content: `Generate 1-line notes for these clients. Use the Monday CRM and Trengo data as primary signal:\n\n${lines}\n\nReturn ONLY a JSON object mapping client ID to note string.`,
      }],
    })

    const text = msg.content[0].type === "text" ? msg.content[0].text : ""
    const jsonMatch = text.match(/\{[\s\S]*\}/)

    const result: Record<string, string> = {}

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, string>
      for (const [id, note] of Object.entries(parsed)) {
        if (typeof note === "string") result[id] = note
      }
    }

    // Merge with existing cache (bump to v3 for new prompt)
    const merged = { ...(cached ?? {}), ...result }
    void writeCache("watchlist_summaries_v3", merged)

    const response: Record<string, string> = {}
    for (const c of clients) {
      if (result[c.id]) response[c.id] = result[c.id]
      else if (cached?.[c.id]) response[c.id] = cached[c.id]
    }

    return NextResponse.json(response)
  } catch (e) {
    console.error("Watchlist summaries error:", e instanceof Error ? e.message : String(e))
    if (cached) {
      const fallback: Record<string, string> = {}
      for (const c of clients) {
        if (cached[c.id]) fallback[c.id] = cached[c.id]
      }
      return NextResponse.json(fallback)
    }
    return NextResponse.json({})
  }
}
