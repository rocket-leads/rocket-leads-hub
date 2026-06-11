import Anthropic from "@anthropic-ai/sdk"
import type { createAdminClient } from "@/lib/supabase/server"
import type { DriveImageRef } from "@/lib/integrations/google-drive"

/**
 * Drive-photo vision relevance reranker.
 *
 * Roy 2026-06-10. Pedro's folder scoring (campaign tokens + sibling
 * blacklist) picks the right FOLDER under a multi-campaign umbrella,
 * but the folder still contains a mix: useful product photos, lifestyle
 * shots, screenshots, brand assets, empty showroom shots. We let Haiku
 * "self think" over the candidates and rank by how well each photo
 * matches the variant's angle.
 *
 * Two-step pipeline so cost stays bounded:
 *   1. DESCRIBE - Haiku vision call per file_id, cached forever in
 *      `pedro_drive_photo_vision`. 1-2 sentences, only what's visible.
 *      ~$0.001 per file, paid once.
 *   2. SCORE - text-only Haiku call combining all descriptions with the
 *      campaign + variant context. Returns ranked file_ids with brief
 *      reasons. Fresh per refresh (~$0.0005 per call), no cache.
 *
 * Failure mode: any error in vision or scoring → fall back to caller's
 * original order. Never block Gemini generation on this enhancement.
 */

const anthropic = new Anthropic()
const VISION_MODEL = "claude-haiku-4-5-20251001"
const SCORE_MODEL = "claude-haiku-4-5-20251001"
const VISION_MAX_TOKENS = 120
const SCORE_MAX_TOKENS = 600

type Supabase = Awaited<ReturnType<typeof createAdminClient>>

export type DrivePhotoContext = {
  campaignName: string | null
  topicLabel: string | null
  adName: string | null
  /** Optional: high-level client positioning (e.g. "B2B juice machines
   *  for restaurants and supermarkets"). When present, gives the
   *  scorer a stronger anchor than just the variant topic. */
  clientPositioning?: string | null
}

/** Per-file Haiku vision call. Cached by file_id. Returns 1-2 sentence
 *  description, or empty string on failure (caller falls back to filename
 *  alone for scoring). */
async function describePhoto(
  supabase: Supabase,
  ref: DriveImageRef,
  clientId: string | null,
): Promise<string> {
  // 1. Cache check
  try {
    const { data: cached } = await supabase
      .from("pedro_drive_photo_vision")
      .select("visual_description, model")
      .eq("file_id", ref.id)
      .maybeSingle<{ visual_description: string; model: string }>()
    if (cached?.visual_description && cached.model === VISION_MODEL) {
      return cached.visual_description
    }
  } catch (e) {
    console.error(
      "[drive-photo-vision] cache read failed:",
      e instanceof Error ? e.message : e,
    )
  }

  // 2. Vision call
  let description = ""
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  try {
    const message = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: VISION_MAX_TOKENS,
      system: `You are a creative assistant labeling stock photos for an ad-generation pipeline. Look at the image and write 1-2 short sentences (max 40 words total) describing:
- The main subject (product, person, environment).
- Any clearly readable on-image text (quote exactly).
- The setting / context (kitchen, showroom, outdoor, abstract).

NEVER speculate about ROI, branding strategy, or fit for a campaign. Just describe what is visible. If the image is a logo, screenshot, document, or otherwise non-photographic, say so plainly ("logo only", "PDF screenshot", "brand pattern").`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: ref.mimeType,
                data: ref.bytes.toString("base64"),
              },
            },
            {
              type: "text",
              text: `Filename: "${ref.name}". Describe this image.`,
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
      `[drive-photo-vision] vision call failed for ${ref.id}:`,
      e instanceof Error ? e.message : e,
    )
    return ""
  }

  if (!description) return ""

  // 3. Cache write - best-effort.
  try {
    await supabase.from("pedro_drive_photo_vision").upsert(
      {
        file_id: ref.id,
        client_id: clientId,
        file_name: ref.name,
        visual_description: description,
        analyzed_at: new Date().toISOString(),
        model: VISION_MODEL,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
      { onConflict: "file_id" },
    )
  } catch (e) {
    console.error(
      "[drive-photo-vision] cache write failed (continuing):",
      e instanceof Error ? e.message : e,
    )
  }

  return description
}

/** Rerank candidates against the variant's campaign context. Returns
 *  the input refs sorted by relevance (best first). Always returns
 *  every input - slicing/limit handled by the caller. */
export async function rerankDrivePhotos(
  supabase: Supabase,
  candidates: DriveImageRef[],
  context: DrivePhotoContext,
  clientId: string | null,
): Promise<DriveImageRef[]> {
  if (candidates.length <= 1) return candidates

  // 1. Describe each (parallel, capped at 4 concurrent to stay under
  //    Haiku rate limits).
  const descriptions = new Map<string, string>()
  const BATCH = 4
  for (let i = 0; i < candidates.length; i += BATCH) {
    const slice = candidates.slice(i, i + BATCH)
    const settled = await Promise.allSettled(
      slice.map((ref) => describePhoto(supabase, ref, clientId)),
    )
    for (let j = 0; j < slice.length; j++) {
      const r = settled[j]
      if (r.status === "fulfilled" && r.value) {
        descriptions.set(slice[j].id, r.value)
      } else {
        // Fallback: empty description so the scorer at least sees the
        // filename. The text-only scoring step handles missing data.
        descriptions.set(slice[j].id, "")
      }
    }
  }

  // 2. Score - single text-only call covering all candidates.
  const ctxParts: string[] = []
  if (context.campaignName) ctxParts.push(`Campaign: ${context.campaignName}`)
  if (context.clientPositioning) ctxParts.push(`Client positioning: ${context.clientPositioning}`)
  if (context.topicLabel) ctxParts.push(`Variant angle / topic: ${context.topicLabel}`)
  if (context.adName) ctxParts.push(`Ad name: ${context.adName}`)
  const ctxBlock = ctxParts.length > 0 ? ctxParts.join("\n") : "(no campaign context)"

  const candidateList = candidates
    .map((ref, idx) => {
      const desc = descriptions.get(ref.id) ?? ""
      return `${idx + 1}. id=${ref.id} | name="${ref.name}"\n   ${desc || "(no description available)"}`
    })
    .join("\n\n")

  let ranking: string[] = []
  try {
    const message = await anthropic.messages.create({
      model: SCORE_MODEL,
      max_tokens: SCORE_MAX_TOKENS,
      system: `You are picking reference photos for an AI image generator that will produce a new Meta ad variant.

You will receive: (a) campaign context, and (b) a numbered list of candidate photos with 1-sentence descriptions.

Your job: rank the candidates from BEST to WORST as references for the new ad. Best = photos that clearly show the product, subject, or setting that matches the campaign and variant angle. Worst = photos that are off-topic, abstract logos, screenshots, low quality, or unrelated products.

Output STRICTLY this format (no preamble, no markdown):
RANK: <id1>, <id2>, <id3>, ...

Use the candidate's id= value, comma-separated, best first. Include ALL candidates exactly once. If two photos are similar quality, pick the one with the clearer subject.`,
      messages: [
        {
          role: "user",
          content: `${ctxBlock}\n\nCandidates:\n${candidateList}\n\nReturn the ranking now.`,
        },
      ],
    })
    const part = message.content[0]
    const raw = part?.type === "text" ? part.text.trim() : ""
    const m = raw.match(/RANK:\s*([^\n]+)/i)
    if (m) {
      ranking = m[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    }
  } catch (e) {
    console.error(
      "[drive-photo-vision] scoring call failed (falling back to original order):",
      e instanceof Error ? e.message : e,
    )
  }

  if (ranking.length === 0) return candidates

  // 3. Reorder by ranking. Anything missing from the ranking goes to
  //    the back in original order (defensive against the model dropping
  //    an id).
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const ordered: DriveImageRef[] = []
  for (const id of ranking) {
    const c = byId.get(id)
    if (c) {
      ordered.push(c)
      byId.delete(id)
    }
  }
  // Push leftovers (in their original order)
  for (const c of candidates) {
    if (byId.has(c.id)) ordered.push(c)
  }
  return ordered
}
