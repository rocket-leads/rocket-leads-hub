import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { loadPedroSystemPrompt } from "@/lib/pedro/knowledge"
import { pastContextForStage, type PedroStage } from "@/lib/pedro/past-campaigns"
import { crossClientExamplesBlock } from "@/lib/pedro/cross-client-examples"

// SDK reads ANTHROPIC_API_KEY from env automatically — same key the rest of
// the hub (watchlist, refresh-cache) uses.
const anthropic = new Anthropic()

// Pedro stages can take 30-60s on Sonnet 4 with the full knowledge-base
// system prompt + past-campaign context + 2500 output tokens (creatives).
// Without this Vercel kills the function at 10s and the client sees a
// HTML 504 page instead of JSON.
export const maxDuration = 120

const VALID_STAGES: PedroStage[] = ["brief", "angles", "script", "creatives", "lp", "ad-copy"]

// Stages where same-vertical RL winners help most. Brief is omitted —
// briefs come from the client's OWN data, cross-client examples would
// contaminate. LP / creatives have less direct copy reuse value. Angles
// + script + ad-copy are where Pedro most benefits from "what already
// works in this niche".
const CROSS_CLIENT_ELIGIBLE_STAGES = new Set<PedroStage>(["angles", "script", "ad-copy"])

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await req.json()
    const { prompt, maxTokens = 1000, images, clientId, stage } = body

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 })
    }

    const content: Anthropic.MessageCreateParams["messages"][0]["content"] = []

    if (images && Array.isArray(images)) {
      for (const img of images) {
        if (img.data && img.mediaType) {
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: img.data,
            },
          })
        }
      }
    }

    content.push({ type: "text", text: prompt })

    // Stage-aware past-campaign context — when caller passes clientId+stage,
    // server enriches system prompt with prior Pedro outputs for that stage
    // so Claude doesn't repeat itself across campaigns.
    //
    // For angles / script / ad-copy stages we ALSO inject cross-client
    // winning examples from same-vertical RL clients (Phase 2). Per
    // knowledge/campaigns.md status note: selection is CPL-driven, not
    // lead-quality-driven (data debt). Inspiration only — never letterlijke
    // kopie, never name-drop andere klanten in output.
    let system = await loadPedroSystemPrompt()
    if (
      typeof clientId === "string" &&
      clientId &&
      typeof stage === "string" &&
      (VALID_STAGES as string[]).includes(stage)
    ) {
      const stageTyped = stage as PedroStage
      const supabase = await createAdminClient()
      const past = await pastContextForStage(clientId, stageTyped, 2).catch(() => "")
      if (past) system = `${system}\n${past}`

      if (CROSS_CLIENT_ELIGIBLE_STAGES.has(stageTyped)) {
        try {
          const { data: stateRow } = await supabase
            .from("pedro_client_state")
            .select("brief")
            .eq("client_id", clientId)
            .order("campaign_number", { ascending: false })
            .limit(1)
            .maybeSingle<{ brief: { sector?: string } | null }>()
          const sector = stateRow?.brief?.sector ?? ""
          if (sector) {
            const xBlock = await crossClientExamplesBlock(supabase, clientId, sector, 5).catch(() => "")
            if (xBlock) system = `${system}\n${xBlock}`
          }
        } catch (e) {
          console.error("Pedro claude: cross-client examples failed", e)
        }
      }
    }

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }],
    })

    const text =
      message.content[0].type === "text" ? message.content[0].text : ""

    return NextResponse.json({ text })
  } catch (e: unknown) {
    console.error("Pedro Claude API error:", e)
    const errorMessage = e instanceof Error ? e.message : "Claude API fout"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
