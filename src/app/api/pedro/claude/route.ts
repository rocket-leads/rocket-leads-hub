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
// system prompt + past-campaign context + 4000 output tokens (creatives).
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

// Model routing. Stages that produce pure structured output (JSON for
// angles + ad copy) don't need Sonnet's reasoning depth — Haiku 4.5 is
// 4-5× faster and ~10× cheaper while passing the same schema. Sonnet
// stays for stages that actually reason: brief, script, creatives (Manus
// specs), LP (Lovable prompt).
const SONNET = "claude-sonnet-4-20250514"
const HAIKU = "claude-haiku-4-5-20251001"
type ModelTier = "sonnet" | "haiku"
function resolveModel(tier: ModelTier | undefined): string {
  return tier === "haiku" ? HAIKU : SONNET
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await req.json()
    const { prompt, maxTokens = 1000, images, clientId, stage, model: modelTier } = body as {
      prompt?: string
      maxTokens?: number
      images?: Array<{ data: string; mediaType: string }>
      clientId?: string
      stage?: string
      model?: ModelTier
    }

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

    // System prompt is split into two blocks so prompt caching can hit
    // the heavy one. The knowledge-base block (~25k tokens of
    // campaigns.md + brand.md) is stable across every Pedro call in a
    // session — marking it cacheable means subsequent calls within 5
    // min reuse the cached tokens at ~90% cost discount + ~85% latency
    // cut. The dynamic block (past-campaign + cross-client examples)
    // changes per (clientId, stage) so it's not worth caching.
    const baseSystem = await loadPedroSystemPrompt()
    const systemBlocks: Anthropic.MessageCreateParams["system"] = [
      {
        type: "text",
        text: baseSystem,
        cache_control: { type: "ephemeral" },
      },
    ]

    if (
      typeof clientId === "string" &&
      clientId &&
      typeof stage === "string" &&
      (VALID_STAGES as string[]).includes(stage)
    ) {
      const stageTyped = stage as PedroStage
      const supabase = await createAdminClient()
      const past = await pastContextForStage(clientId, stageTyped, 2).catch(() => "")

      let extras = past || ""
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
            if (xBlock) extras = extras ? `${extras}\n${xBlock}` : xBlock
          }
        } catch (e) {
          console.error("Pedro claude: cross-client examples failed", e)
        }
      }

      if (extras) {
        systemBlocks.push({ type: "text", text: extras })
      }
    }

    const message = await anthropic.messages.create({
      model: resolveModel(modelTier),
      max_tokens: maxTokens,
      system: systemBlocks,
      messages: [{ role: "user", content }],
    })

    const text =
      message.content[0]?.type === "text" ? message.content[0].text : ""

    // stop_reason lets the client detect truncation (`max_tokens`) and
    // either warn the CM or retry with a higher cap. Without it a
    // silent cut-off looks identical to a complete response.
    return NextResponse.json({
      text,
      stopReason: message.stop_reason,
      usage: message.usage,
    })
  } catch (e: unknown) {
    console.error("Pedro Claude API error:", e)
    const errorMessage = e instanceof Error ? e.message : "Claude API fout"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
