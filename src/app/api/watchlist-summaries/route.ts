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
  const cached = await readCache<Record<string, string>>("watchlist_summaries_v4")

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
      `[CLIENT ${c.id}] ${c.name} | ${c.category.toUpperCase()}`,
      `INSIGHT COLUMN (already visible — DO NOT REPEAT): "${c.issue}"`,
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
      system: `You are a senior campaign manager at Rocket Leads, a Dutch lead generation agency. Generate a 1-line AI Note for each client.

## CRITICAL — THE AI NOTE IS AN ADDITION, NOT A REPEAT
Each client already has an "Insight" column visible to the user (provided as "INSIGHT COLUMN" in the data). The AI Note appears NEXT to it. The user reads Insight FIRST, then AI Note.

**ABSOLUTE RULE: NEVER repeat or rephrase what's in the Insight column.**
- If Insight says "CPL up 239%" → your note must NOT mention CPL or the percentage again
- If Insight says "€695 spent, 0 leads" → your note must NOT say "zero leads" or "no leads generated"
- The AI Note adds the NEXT LAYER: what to DO about it, or WHY it's happening, or which specific ad to act on

**The AI Note should answer: "OK I see the Insight, but what SPECIFICALLY should I do?"**

## DATA PRIORITY
1. **MONDAY CRM UPDATES** — AM/setter notes about lead quality, client feedback
2. **TRENGO CONVERSATIONS** — Client messages, satisfaction, complaints
3. **KPI DATA** — Supporting evidence only

## BE CONCRETE — NAME THE AD
When recommending creative iterations or pauses, reference the SPECIFIC winning/losing ad by name when available in Monday/Trengo context. Don't say "test 2 new variants" — say "iterate on [winning ad name], 2-3 new variants same hook".

## PRINCIPLES
- Fixed budgets (€1k-3k/month). NEVER recommend budget increases.
- NEVER recommend "keep running" — winners decay. Always iterate.
- Don't blindly trust client complaints:
  - "Leads don't pick up" → follow-up timing issue, not campaign problem
  - "No budget" → add budget question to form
  - "Not interested" → wrong audience or slow follow-up

## FORMAT RULES
- The note must ADD information beyond the Insight column
- Be specific: name ads, UTMs, or funnel elements where possible
- Keep under 25 words. Direct, no fluff.
- Write in English

Output JSON only: {"client_id": "note", ...}`,
      messages: [{
        role: "user",
        content: `Generate AI Notes for these clients. Each client has an "INSIGHT COLUMN" already shown — your note must ADD to it, NEVER repeat it. Be concrete: name specific ads to iterate on or pause.\n\n${lines}\n\nReturn ONLY a JSON object mapping client ID to note string.`,
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
    void writeCache("watchlist_summaries_v4", merged)

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
