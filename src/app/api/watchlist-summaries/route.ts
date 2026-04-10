import { auth } from "@/lib/auth"
import { readCache, writeCache } from "@/lib/cache"
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

  // Check cache first
  const cached = await readCache<Record<string, string>>("watchlist_summaries_v2")

  // Find which clients need new summaries
  const needed = clients.filter((c) => !cached?.[c.id])
  if (needed.length === 0 && cached) {
    const result: Record<string, string> = {}
    for (const c of clients) {
      if (cached[c.id]) result[c.id] = cached[c.id]
    }
    return NextResponse.json(result)
  }

  // Build prompt for all clients (needed + existing)
  const allClients = clients.slice(0, 50) // cap at 50
  const lines = allClients.map((c) => {
    const cplChange = c.prevCpl > 0 ? ((c.cpl - c.prevCpl) / c.prevCpl * 100).toFixed(0) : "n/a"
    const cpaChange = c.prevCostPerAppointment > 0 ? ((c.costPerAppointment - c.prevCostPerAppointment) / c.prevCostPerAppointment * 100).toFixed(0) : "n/a"
    return `${c.id}|${c.name}|${c.category}|${c.issue}|spend:€${c.adSpend.toFixed(0)}|leads:${c.leads}|CPL:€${c.cpl.toFixed(2)}|CPL%:${cplChange}%|appts:${c.appointments}|CPA:€${c.costPerAppointment.toFixed(0)}|CPA%:${cpaChange}%`
  }).join("\n")

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 3000,
      system: `You are a senior campaign manager at Rocket Leads, a Dutch lead generation agency. Generate a 1-line actionable note for each client based on their KPI data.

CRITICAL CONTEXT — Rocket Leads clients have FIXED, LIMITED ad budgets:
- Most clients spend €1,000–€3,000/month total — this is their hard ceiling.
- Clients almost NEVER scale budget. Budget is not flexible.
- DO NOT recommend "scale budget", "increase spend", "scale this ad set", or any variation.
- The lever is ALWAYS: better creatives, better angles, better targeting, better landing pages — NOT more spend.
- If a campaign performs well, the recommendation is to KEEP IT RUNNING and replicate the winning angle/creative type in the next refresh — not to scale budget.

Rules:
- For ACTION clients: say what specific action to take (pause underperforming ads, test new creative angle, refresh ad copy, fix landing page, adjust targeting). NEVER suggest budget changes.
- For WATCH clients: say what to monitor and when to act (e.g. "CPL rising — if it continues 2 more days, pause underperformer and launch new creative")
- For GOOD clients: highlight what's working and suggest how to PROTECT or REPLICATE it (e.g. "CPL dropped 40% — winning angle, replicate in next creative refresh", "Stable performance, keep current ads running, prep next angle for monthly refresh")
- Reference actual numbers (CPL, spend, leads, % changes)
- Keep each note under 18 words. Be direct, no fluff.
- Write in English

Output JSON only: {"client_id": "note", ...}`,
      messages: [{
        role: "user",
        content: `Generate 1-line notes for these clients:\n${lines}\n\nReturn ONLY a JSON object mapping client ID to note string.`,
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

    // Merge with existing cache and write back
    const merged = { ...(cached ?? {}), ...result }
    void writeCache("watchlist_summaries_v2", merged)

    // Return only requested clients
    const response: Record<string, string> = {}
    for (const c of clients) {
      if (result[c.id]) response[c.id] = result[c.id]
      else if (cached?.[c.id]) response[c.id] = cached[c.id]
    }

    return NextResponse.json(response)
  } catch (e) {
    console.error("Watchlist summaries error:", e instanceof Error ? e.message : String(e))
    // Return cached data if available
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
