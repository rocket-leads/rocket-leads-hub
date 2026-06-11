import { NextRequest } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { loadPedroSystemPrompt } from "@/lib/pedro/knowledge"
import { pastContextForStage, type PedroStage } from "@/lib/pedro/past-campaigns"
import { crossClientExamplesBlock } from "@/lib/pedro/cross-client-examples"
import {
  buildAnglesPrompt,
  buildScriptPrompt,
  buildCreativesDescriptionsPrompt,
  buildLpPrompt,
  buildAdCopyPrompt,
} from "@/lib/pedro/prompts"

// SDK reads ANTHROPIC_API_KEY from env automatically - same key the rest of
// the hub (watchlist, refresh-cache) uses.
const anthropic = new Anthropic()

// Pedro stages can take 30-60s on Sonnet 4 with the full knowledge-base
// system prompt + past-campaign context + 4000 output tokens (creatives).
// Without this Vercel kills the function at 10s and the client sees a
// HTML 504 page instead of JSON.
export const maxDuration = 120

// Stages where same-vertical RL winners help most. Brief is omitted -
// briefs come from the client's OWN data, cross-client examples would
// contaminate. LP / creatives have less direct copy reuse value. Angles
// + script + ad-copy are where Pedro most benefits from "what already
// works in this niche".
const CROSS_CLIENT_ELIGIBLE_STAGES = new Set<PedroStage>(["angles", "script", "ad-copy"])

// Model routing. Stages that produce pure structured output (JSON for
// angles + ad copy) don't need Sonnet's reasoning depth - Haiku 4.5 is
// 4-5× faster and ~10× cheaper while passing the same schema. Sonnet
// stays for stages that actually reason: brief, script, creatives (Manus
// specs), LP (Lovable prompt).
const SONNET = "claude-sonnet-4-20250514"
const HAIKU = "claude-haiku-4-5-20251001"
type ModelTier = "sonnet" | "haiku"
function resolveModel(tier: ModelTier | undefined): string {
  return tier === "haiku" ? HAIKU : SONNET
}

/**
 * Per-stage config: which builder produces the prompt, default model,
 * default max_tokens. Owning these defaults server-side means the
 * client just says `stage: "lp"` and the server picks the right cost
 * / latency / quality trade-off - no leaking model IDs into bundles.
 * Client may still override via the request body when a special case
 * demands it.
 */
type StageConfig = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: (options: any) => string
  defaultMaxTokens: number
  defaultModel: ModelTier
}
const STAGE_CONFIGS: Record<string, StageConfig> = {
  angles: { build: buildAnglesPrompt, defaultMaxTokens: 1500, defaultModel: "haiku" },
  script: { build: buildScriptPrompt, defaultMaxTokens: 1500, defaultModel: "sonnet" },
  creatives: { build: buildCreativesDescriptionsPrompt, defaultMaxTokens: 4000, defaultModel: "sonnet" },
  lp: { build: buildLpPrompt, defaultMaxTokens: 2500, defaultModel: "sonnet" },
  "ad-copy": { build: buildAdCopyPrompt, defaultMaxTokens: 1200, defaultModel: "haiku" },
}

/**
 * Pedro generation endpoint. Always streams via Server-Sent Events so the
 * client can render text progressively as Claude generates it. Event types:
 *
 *   data: {"type":"text","delta":"..."}         - text chunk
 *   data: {"type":"done","text":"...","stopReason":"end_turn","usage":{...}}
 *   data: {"type":"error","message":"..."}
 *
 * Request body:
 *   stage:      "angles" | "script" | "creatives" | "lp" | "ad-copy"
 *   options:    the typed args object for the corresponding prompt builder
 *   clientId:   optional - when present, server injects past-campaign +
 *               cross-client context into the system prompt
 *   model:      optional override - defaults from STAGE_CONFIGS
 *   maxTokens:  optional override - defaults from STAGE_CONFIGS
 *
 * The `done` event carries the canonical full text + stop_reason so the
 * client doesn't need to concatenate deltas correctly to know when to fire
 * its truncation retry. Errors mid-stream still emit a `done` after the
 * `error` so clients can rely on the stream always terminating cleanly.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return sseErrorResponse("Unauthorized", 401)
  }

  let body: {
    stage?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options?: any
    clientId?: string
    model?: ModelTier
    maxTokens?: number
  }
  try {
    body = await req.json()
  } catch {
    return sseErrorResponse("Invalid JSON body", 400)
  }
  const { stage, options, clientId, model: modelOverride, maxTokens: maxTokensOverride } = body

  if (!stage || typeof stage !== "string" || !STAGE_CONFIGS[stage]) {
    return sseErrorResponse(`Unknown stage: ${stage ?? "(missing)"}`, 400)
  }
  if (!options || typeof options !== "object") {
    return sseErrorResponse("options is required", 400)
  }

  const stageConfig = STAGE_CONFIGS[stage]
  // Strip the magic `_jsonRetry` flag before passing to the builder so
  // none of the typed builders need to know about it. When set, we
  // append a strict "JSON only" reminder to the built prompt - used by
  // callPedroJson on the client to recover from Claude preambles that
  // break parseJSON.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { _jsonRetry, ...builderOptions } = options as any
  let prompt: string
  try {
    prompt = stageConfig.build(builderOptions)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "prompt build failed"
    return sseErrorResponse(`Bad options for stage ${stage}: ${msg}`, 400)
  }
  if (_jsonRetry) {
    prompt += `\n\nBELANGRIJK: Je vorige antwoord was geen geldige JSON. Geef nu ALLEEN het JSON-object/array. Geen preamble, geen markdown-fences, geen uitleg, geen tekst eromheen - alleen pure JSON die direct te parsen is.`
  }

  const maxTokens = typeof maxTokensOverride === "number" ? maxTokensOverride : stageConfig.defaultMaxTokens
  const modelTier = modelOverride ?? stageConfig.defaultModel

  // System prompt is split into two blocks so prompt caching can hit
  // the heavy one. The knowledge-base block (~25k tokens of
  // campaigns.md + brand.md) is stable across every Pedro call in a
  // session - marking it cacheable means subsequent calls within 5
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

  if (typeof clientId === "string" && clientId) {
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

  const encoder = new TextEncoder()
  const sse = (payload: object) =>
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const messageStream = anthropic.messages.stream({
          model: resolveModel(modelTier),
          max_tokens: maxTokens,
          system: systemBlocks,
          messages: [{ role: "user", content: prompt }],
        })

        for await (const event of messageStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta" &&
            event.delta.text
          ) {
            controller.enqueue(sse({ type: "text", delta: event.delta.text }))
          }
        }

        const final = await messageStream.finalMessage()
        const text =
          final.content[0]?.type === "text" ? final.content[0].text : ""
        controller.enqueue(
          sse({
            type: "done",
            text,
            stopReason: final.stop_reason,
            usage: final.usage,
          }),
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Claude stream error"
        console.error("Pedro Claude stream error:", e)
        controller.enqueue(sse({ type: "error", message: msg }))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disables Vercel's response buffering so deltas reach the client
      // immediately. Without this, chunks may sit in a proxy until the
      // upstream connection closes - eliminating the perceived-speed win
      // streaming is supposed to give.
      "X-Accel-Buffering": "no",
    },
  })
}

/** Same SSE shape as the happy path so the client only has to parse one
 *  format. The single `error` event is followed by `done` so the
 *  client-side stream reader can terminate cleanly. */
function sseErrorResponse(message: string, status: number) {
  const encoder = new TextEncoder()
  const body =
    encoder.encode(
      `data: ${JSON.stringify({ type: "error", message })}\n\n` +
        `data: ${JSON.stringify({ type: "done", text: "", stopReason: null, usage: null })}\n\n`,
    )
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  })
}
