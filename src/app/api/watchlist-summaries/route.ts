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
  /** True only when a Monday board was linked AND we successfully read items from it */
  mondayCrmConnected?: boolean
  /** True when leads came from Meta because Monday returned no usable data */
  leadsFromMetaFallback?: boolean
  /** True when the client even has a Monday board ID configured */
  hasClientBoardId?: boolean
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { clients } = (await req.json()) as { clients: ClientInput[] }
  if (!clients?.length) return NextResponse.json({})

  // Check note cache
  const cached = await readCache<Record<string, string>>("watchlist_summaries_v6")

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

    // Build the data-availability summary so the model knows what's UNKNOWN vs really zero.
    const crmConnected = c.mondayCrmConnected === true
    const leadsSource = c.leadsFromMetaFallback ? "Meta `actions` (Monday CRM unavailable)" : "Monday CRM"

    // Appointments are ONLY trackable via Monday CRM. If Monday isn't connected,
    // the on-screen "0" is missing data, not a real zero.
    const apptsLine = crmConnected
      ? `appts ${c.appointments} | CPA €${c.costPerAppointment.toFixed(0)} (${cpaChange}% wow)`
      : `appts UNKNOWN — Monday CRM not connected (do NOT claim 0 appointments) | CPA UNKNOWN`

    const parts = [
      `[CLIENT ${c.id}] ${c.name} | ${c.category.toUpperCase()}`,
      `DATA AVAILABILITY: leads source = ${leadsSource}; Monday CRM = ${crmConnected ? "CONNECTED" : "NOT CONNECTED (no board linked or fetch failed)"}; appointments trackable = ${crmConnected ? "yes" : "NO"}`,
      `INSIGHT COLUMN (already visible — DO NOT REPEAT): "${c.issue}"`,
      `KPIs [WINDOW: last 7d]: spend €${c.adSpend.toFixed(0)} | leads ${c.leads} | CPL €${c.cpl.toFixed(2)} (${cplChange}% wow) | ${apptsLine}`,
    ]

    const ctx = contextCache[c.id]
    if (crmConnected && ctx?.mondayUpdates) {
      // Lead status counts in this block are ALL-TIME (lifetime board totals).
      // Recent update texts are from the last 14d only.
      parts.push(`MONDAY CRM [WINDOW: status counts = all-time, update texts = last 14d]:\n${ctx.mondayUpdates.slice(0, 800)}`)
    }
    if (ctx?.trengoSummary) {
      parts.push(`TRENGO CONVERSATIONS [WINDOW: last 14d]:\n${ctx.trengoSummary.slice(0, 800)}`)
    }
    if ((!crmConnected || !ctx?.mondayUpdates) && !ctx?.trengoSummary) {
      parts.push(`(No qualitative data available — Meta KPI data only. Focus on creative/CPL/ad-fatigue angles, not lead-quality or appointment claims.)`)
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

## CRITICAL — KNOW WHAT DATA YOU HAVE BEFORE YOU WRITE ANYTHING
Each client comes with a "DATA AVAILABILITY" line. Read it first. It tells you whether Monday CRM is connected and whether appointment data is trackable for that client.

**When Monday CRM = NOT CONNECTED:**
- The KPI block will show \`appts UNKNOWN\` and \`CPA UNKNOWN\`. The on-screen "0 appts" the user sees in the column is also missing-data, not a real zero. NEVER write any of these:
  - "0 appointments"
  - "no appointments generated"
  - "zero appts"
  - "leads aren't converting to appointments"
  - "audience mismatch — no appts"
  - any conversion-rate claim that uses appointments
- Also DO NOT write claims about lead quality / lead sentiment — that data lives in Monday updates, which you don't have for this client.
- Instead, focus on Meta-trackable angles only:
  - CPL trend, ad-set fatigue, creative variation depth, CTR decay, CPM, frequency
  - "Itereer op winning hook", "Test new angle X", "Pause [ad name] — €Y CPL spike (7d)"
  - You may suggest: "Verify with client — no CRM linked, ask if appointments are being booked offline" — but only if the absence is itself the most useful insight.

**When Monday CRM = CONNECTED:**
- You can use leads, appts, lead-quality, and Monday update sentiment freely (with window labels per below).

If you write a claim that depends on data flagged UNKNOWN, that's a hard failure — the campaign manager will lose trust in every note.

## CRITICAL — TIME WINDOW LABELS ARE MANDATORY ON EVERY NUMBER
The KPI columns the user sees on screen (spend, leads, CPL, appts) are LAST 7 DAYS. The qualitative inputs you receive cover different windows:
- **KPIs block** = last 7d (and 7d-vs-prev-7d % deltas)
- **MONDAY CRM block** = lead status counts are ALL-TIME (lifetime board totals); recent update texts are from the last 14d
- **TRENGO CONVERSATIONS block** = last 14d

**Every numeric claim in your note MUST include its window inline**, e.g. "25 leads (all-time), 0 appts (all-time)" or "8 'no budget' replies (14d)" or "47 'wrong region' updates (all-time)". Never write a bare number.

**Why this matters:** if the column shows "5 leads (7d)" and your note says "25 leads, 0 appts" without a window, the campaign manager thinks the dashboard is broken. The window label is the proof that two different numbers are both correct. Without it the note kills trust in the whole product. This is non-negotiable.

If you can't tell what window a number came from in the data you were given, do not use that number — pick a different angle.

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
- Every number gets a window label in parentheses: (7d), (14d), (all-time)
- Keep under 30 words. Direct, no fluff.
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

    // Merge with existing cache (bump cache key when prompt changes so stale notes regenerate)
    const merged = { ...(cached ?? {}), ...result }
    void writeCache("watchlist_summaries_v6", merged)

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
