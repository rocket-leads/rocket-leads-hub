import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { readFile } from "fs/promises"
import { join } from "path"

const anthropic = new Anthropic()

type LeadFeedbackEntry = {
  utm: string
  totalLeads: number
  updates: Array<{ text: string; leadStatus: string }>
}

type AdDetailEntry = {
  adName: string
  adsetName: string
  spend: number
  impressions: number
  clicks: number
  ctr: number
  cpc: number
  body: string
  creativeType: string
}

type RequestBody = {
  clientName: string
  boardType: "onboarding" | "current"
  kpis7d: Record<string, unknown> | null
  kpis14d: Record<string, unknown> | null
  kpis30d: Record<string, unknown> | null
  hasCrm: boolean
  leadFeedback?: LeadFeedbackEntry[]
  adDetails?: AdDetailEntry[]
}

async function loadKnowledgeFile(filename: string): Promise<string> {
  try {
    const path = join(process.cwd(), "knowledge", filename)
    return await readFile(path, "utf-8")
  } catch {
    return ""
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const body: RequestBody = await req.json()

  const supabase = await createAdminClient()

  // Load client knowledge from Supabase
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", mondayItemId)
    .single()

  let knowledgeContext = ""
  if (client) {
    const { data: knowledge } = await supabase
      .from("client_knowledge")
      .select("title, content, source")
      .eq("client_id", client.id)

    if (knowledge && knowledge.length > 0) {
      knowledgeContext = knowledge
        .map((k) => `### ${k.title} (source: ${k.source})\n${k.content}`)
        .join("\n\n---\n\n")
    }
  }

  // Load Rocket Leads frameworks
  const [campaignsKnowledge, processKnowledge] = await Promise.all([
    loadKnowledgeFile("campaigns.md"),
    loadKnowledgeFile("process.md"),
  ])

  const systemPrompt = `You are a senior performance marketing strategist at Rocket Leads, a Dutch lead generation agency. You write campaign optimization proposals for clients.

## Your role
- Analyze KPI trends (7d vs 14d vs 30d) and generate actionable optimization recommendations
- Use client-specific context (kick-off notes, ICP, USPs, brand guidelines) to make recommendations highly personalized
- Reference Rocket Leads' proven frameworks and marketing angles when suggesting improvements

## Output format
Return a JSON array of insights. Each insight has:
- "type": "positive" | "warning" | "critical" | "action"
- "title": the observation — what's happening, with key numbers (max 60 chars). Example: "0 appointments booked in 7 days"
- "action": the fix — one concrete next step (max 60 chars). Example: "Check follow-up loop in Zapier + WhatsApp sequence"
- "detail": optional deeper context for those who want it (1-2 sentences max). This is hidden by default.

CRITICAL: A campaign manager reads this for 100 clients. Be extremely concise. Two scannable lines per insight: what's wrong + what to do. No fluff, no filler, no repeating numbers from the title.

Return 2-4 insights max, only the highest-impact ones. Skip "everything looks fine" insights.

## Important rules
- All currency in EUR (€), dot as decimal separator
- Write in English
- Title = observation with numbers. Action = specific fix. Detail = optional why/context.
- Reference specific marketing angles and ad names when relevant
- If lead feedback shows negative patterns per UTM (e.g. "niet geïnteresseerd"), name the specific ad
- Cross-reference ad CTR with lead feedback quality — good CTR + bad feedback = wrong audience
- Dynamic ads (name contains "Dynamic"/"DYN") have multiple variants — don't flag low ad count
- Consider board type: onboarding clients need different advice than active clients

## Rocket Leads Campaign Framework
${campaignsKnowledge.slice(0, 3000)}

## Rocket Leads Process
${processKnowledge.slice(0, 2000)}`

  const userPrompt = `## Client: ${body.clientName}
Board type: ${body.boardType}
Has CRM data: ${body.hasCrm}

## KPI Data

### Last 7 days
${body.kpis7d ? JSON.stringify(body.kpis7d, null, 2) : "No data"}

### Last 14 days
${body.kpis14d ? JSON.stringify(body.kpis14d, null, 2) : "No data"}

### Last 30 days
${body.kpis30d ? JSON.stringify(body.kpis30d, null, 2) : "No data"}

## Meta Ad Details (last 30 days)
${body.adDetails && body.adDetails.length > 0
    ? body.adDetails.map((ad) =>
        `- **${ad.adName}** (${ad.creativeType}) | Ad set: ${ad.adsetName}\n  Spend: €${ad.spend.toFixed(2)} | Impressions: ${ad.impressions} | Clicks: ${ad.clicks} | CTR: ${ad.ctr.toFixed(2)}% | CPC: €${ad.cpc.toFixed(2)}\n  Ad copy: "${ad.body.slice(0, 200)}${ad.body.length > 200 ? "…" : ""}"`
      ).join("\n\n")
    : "No ad details available."}

## Lead Feedback from Monday Updates (qualitative data from client/appointment setters)
${body.leadFeedback && body.leadFeedback.length > 0
    ? body.leadFeedback.map((fb) =>
        `### Ad/UTM: ${fb.utm} (${fb.totalLeads} total leads)\n${fb.updates.slice(0, 10).map((u) => `- [${u.leadStatus}] "${u.text.slice(0, 150)}${u.text.length > 150 ? "…" : ""}"`).join("\n")}`
      ).join("\n\n")
    : "No lead feedback available."}

## Client Knowledge Base
${knowledgeContext || "No client-specific knowledge available yet. Generate insights based on KPI data only."}

---

Generate the optimization proposal. Return ONLY a JSON array, no markdown wrapping.`

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [
        { role: "user", content: userPrompt },
      ],
      system: systemPrompt,
    })

    const text = message.content[0].type === "text" ? message.content[0].text : ""

    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      return NextResponse.json({ error: "Failed to parse AI response", raw: text }, { status: 500 })
    }

    const insights = JSON.parse(jsonMatch[0])
    return NextResponse.json({ insights, hasKnowledge: !!knowledgeContext })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("AI proposal error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
