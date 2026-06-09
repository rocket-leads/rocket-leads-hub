import Anthropic from "@anthropic-ai/sdk"
import type { createAdminClient } from "@/lib/supabase/server"

/**
 * Ad-creative vision analyzer.
 *
 * Voor elke ad die in een creative-refresh prompt belandt (winners +
 * top losers) doen we ÉÉN keer een Claude Haiku vision call op de
 * thumbnail. Output is een 100-200 woord beschrijving van:
 *   - subject, products, people, setting
 *   - on-image text overlays (welke woorden, welke kleur/positie)
 *   - mood, lighting, color palette
 *   - brand cues (logos, recurring elements)
 *
 * Cache-first via `pedro_ad_creative_vision`: dezelfde ad krijgt nooit
 * een tweede call. Cost: ~$0.001 per ad, eenmalig.
 *
 * Roy 2026-06-09: zonder dit verzint Pedro de winner DNA op basis van
 * alleen de ad-naam ("Tosti's") en wat getallen.
 */

const anthropic = new Anthropic()
const MODEL = "claude-haiku-4-5-20251001"
const MAX_TOKENS = 400

type Supabase = Awaited<ReturnType<typeof createAdminClient>>

export type AdVisionInput = {
  adId: string
  adName: string
  thumbnailUrl: string
  clientId: string
}

/** Get vision description from cache OR generate + cache it. Returns
 *  empty string when the thumbnail isn't fetchable or the model refuses
 *  — caller treats absence as "no visual data" and falls back to copy
 *  alone. */
export async function analyzeAdCreativeVision(
  supabase: Supabase,
  input: AdVisionInput,
): Promise<string> {
  if (!input.adId || !input.thumbnailUrl) return ""

  // 1. Cache check
  try {
    const { data: cached } = await supabase
      .from("pedro_ad_creative_vision")
      .select("visual_description, model")
      .eq("ad_id", input.adId)
      .maybeSingle<{ visual_description: string; model: string }>()
    if (cached?.visual_description && cached.model === MODEL) {
      return cached.visual_description
    }
  } catch (e) {
    console.error(
      "[ad-creative-vision] cache read failed:",
      e instanceof Error ? e.message : e,
    )
    // fall through to live analyze
  }

  // 2. Download thumbnail → base64 for Anthropic vision input
  let imageBase64: string
  let imageMediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"
  try {
    const res = await fetch(input.thumbnailUrl)
    if (!res.ok) return ""
    const arrayBuffer = await res.arrayBuffer()
    imageBase64 = Buffer.from(arrayBuffer).toString("base64")
    const headerMime = res.headers.get("content-type") ?? ""
    imageMediaType = headerMime.includes("png")
      ? "image/png"
      : headerMime.includes("webp")
        ? "image/webp"
        : headerMime.includes("gif")
          ? "image/gif"
          : "image/jpeg"
  } catch {
    return ""
  }

  // 3. Claude Haiku vision call
  let description = ""
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: `You are a senior creative strategist analyzing Meta ad creatives. Your job: describe what's visually in an ad so a campaign manager can understand WHY it works and iterate in the same DNA.

Output requirements:
- Plain English, 100-180 words.
- One paragraph, no markdown, no bullets.
- Describe in this order: (1) subject + products + people, (2) setting + environment, (3) any on-image text overlay quote it EXACTLY including language, (4) mood + lighting + color palette, (5) brand cues you can see (logos, recurring style elements).
- NEVER speculate about ROI, performance, or business model. JUST what you see.
- If text is in Dutch, quote it in Dutch but write surrounding analysis in English.
- If image is low-res or partially obscured, say so briefly at the end.`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: imageMediaType,
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: `Ad name: "${input.adName}". Describe this ad creative.`,
            },
          ],
        },
      ],
    })
    const part = message.content[0]
    description = part?.type === "text" ? part.text.trim() : ""
    inputTokens = message.usage?.input_tokens ?? null
    outputTokens = message.usage?.output_tokens ?? null
  } catch (e) {
    console.error(
      `[ad-creative-vision] Haiku call failed for ${input.adId}:`,
      e instanceof Error ? e.message : e,
    )
    return ""
  }

  if (!description) return ""

  // 4. Cache write — upsert so re-analyzing the same ad updates rather
  //    than collides. Failures are non-blocking; we still return the
  //    description.
  try {
    await supabase
      .from("pedro_ad_creative_vision")
      .upsert(
        {
          ad_id: input.adId,
          client_id: input.clientId,
          thumbnail_url: input.thumbnailUrl,
          visual_description: description,
          analyzed_at: new Date().toISOString(),
          model: MODEL,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
        { onConflict: "ad_id" },
      )
  } catch (e) {
    console.error(
      "[ad-creative-vision] cache write failed (continuing):",
      e instanceof Error ? e.message : e,
    )
  }

  return description
}

/** Analyze multiple ads in parallel — used by creative-refresh to get
 *  vision for all top winners + losers in one go. Returns a Map keyed
 *  by adId for easy lookup when building the prompt. */
export async function analyzeAdsParallel(
  supabase: Supabase,
  inputs: AdVisionInput[],
): Promise<Map<string, string>> {
  if (inputs.length === 0) return new Map()
  const BATCH = 4 // 4 parallel keeps us well under Haiku's rate limits
  const result = new Map<string, string>()
  for (let i = 0; i < inputs.length; i += BATCH) {
    const slice = inputs.slice(i, i + BATCH)
    const settled = await Promise.allSettled(
      slice.map((inp) => analyzeAdCreativeVision(supabase, inp)),
    )
    for (let j = 0; j < slice.length; j++) {
      const r = settled[j]
      if (r.status === "fulfilled" && r.value) {
        result.set(slice[j].adId, r.value)
      }
    }
  }
  return result
}
