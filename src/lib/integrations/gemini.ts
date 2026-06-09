import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

/**
 * Gemini image generation — Nano Banana Pro (gemini-3-pro-image).
 *
 * Pedro's image-gen backend. Takes the winning ad's thumbnail as a
 * reference image plus a per-variant `imagePrompt` describing the
 * intended variation, returns brand-consistent ad creative.
 *
 * Why Gemini and not OpenAI / Stability:
 *   - Best-in-class text rendering on images (critical for Meta ads
 *     where "Bespaar €400/maand" must be legible, not gibberish).
 *   - Multi-turn editing with identity preservation — purpose-built
 *     for "iterate in same DNA" workflows.
 *   - Up to 4K output, single API call.
 *
 * Auth: API key stored encrypted in `api_tokens` table, service
 * `gemini`. Roy provisions via Settings → API Tokens.
 *
 * Roy 2026-06-09.
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"

/** Production-tier image model. Override per-call when we want to A/B
 *  against 2.5 Flash Image (much cheaper, slightly worse text). */
export const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image-preview"

async function getApiKey(): Promise<string> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "gemini")
    .single()
  if (!data) {
    throw new Error("Gemini API key niet geconfigureerd. Ga naar Settings → API Tokens.")
  }
  return decrypt(data.token_encrypted)
}

export type GeminiImageResult = {
  bytes: Buffer
  mimeType: "image/jpeg" | "image/png"
  width: number | null
  height: number | null
  model: string
}

type GeminiContentPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
        inline_data?: { mime_type?: string; data?: string }
        inlineData?: { mimeType?: string; data?: string }
      }>
    }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
  error?: { message?: string; status?: string; code?: number }
}

/**
 * Generate a single image from a prompt + optional reference images.
 *
 * Reference images are passed as `inline_data` parts before the text
 * prompt — Gemini's docs recommend image-first ordering when editing
 * (the model treats earlier images as the canvas to manipulate).
 *
 * Returns the image bytes + dimensions when the model attached them
 * to the response. When the model refuses (safety filter, no image
 * generated) we throw with the model's stated reason so the calling
 * endpoint can surface it to the CM.
 */
export async function generateImageWithReference(args: {
  prompt: string
  /** Optional reference images (e.g., the winning ad's thumbnail).
   *  Up to 3 — Gemini accepts more but practically the loss of fidelity
   *  past 3 isn't worth it. */
  referenceImages?: Array<{ bytes: Buffer; mimeType: "image/jpeg" | "image/png" }>
  /** Override model — defaults to Nano Banana Pro. */
  model?: string
  /** Aspect ratio target. Image-only MVP → square (Feed) default. Pass
   *  "9:16" if/when we add video/Reels support. */
  aspectRatio?: "1:1" | "1.91:1" | "9:16"
}): Promise<GeminiImageResult> {
  const apiKey = await getApiKey()
  const model = args.model ?? DEFAULT_IMAGE_MODEL

  // Compose contents: reference images first, then the text prompt.
  // This is the recommended ordering per Google's image-editing docs.
  const parts: GeminiContentPart[] = []
  for (const ref of args.referenceImages ?? []) {
    parts.push({
      inline_data: {
        mime_type: ref.mimeType,
        data: ref.bytes.toString("base64"),
      },
    })
  }
  // Wrap the prompt with a hard constraint so Gemini emits an image,
  // not a text-only explanation. Without this it sometimes responds
  // "Sure, here's what I'd do..." which kills the workflow.
  const aspectLine = args.aspectRatio ? `\nAspect ratio: ${args.aspectRatio}.` : ""
  const refLine = (args.referenceImages?.length ?? 0) > 0
    ? "\nUse the reference image above for brand style, color palette, lighting, and subject identity. Keep that DNA recognisable while applying the changes below."
    : ""
  parts.push({
    text: `${args.prompt}${refLine}${aspectLine}\n\nReturn ONLY the generated image. Do not include any text response.`,
  })

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      // Force image output. Without this Gemini may choose text-only.
      responseModalities: ["IMAGE"],
    },
  }

  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    let parsedErr: GeminiResponse | null = null
    try {
      parsedErr = JSON.parse(text) as GeminiResponse
    } catch {
      /* not JSON */
    }
    const message =
      parsedErr?.error?.message ??
      text.slice(0, 300) ??
      `HTTP ${res.status}`
    throw new Error(`Gemini image gen faalde: ${message}`)
  }

  const json = (await res.json()) as GeminiResponse

  if (json.promptFeedback?.blockReason) {
    throw new Error(
      `Gemini blokkeerde de prompt: ${json.promptFeedback.blockReason}. Pas de imagePrompt aan en probeer opnieuw.`,
    )
  }

  // Walk the candidates → parts to find the image data. The API can
  // return inline_data (snake_case) or inlineData (camelCase) depending
  // on the model and SDK version — handle both.
  for (const candidate of json.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const data = part.inline_data?.data ?? part.inlineData?.data
      const mime = part.inline_data?.mime_type ?? part.inlineData?.mimeType
      if (data && mime) {
        const bytes = Buffer.from(data, "base64")
        const normalisedMime: "image/jpeg" | "image/png" =
          mime.includes("png") ? "image/png" : "image/jpeg"
        return {
          bytes,
          mimeType: normalisedMime,
          // Gemini doesn't currently expose width/height in the response —
          // future API versions might. Null for now; UI shows it as
          // unknown and the launch endpoint reads dimensions from bytes
          // when it really needs them.
          width: null,
          height: null,
          model,
        }
      }
    }
  }

  // No image data in the response — usually means the model returned a
  // text refusal or hit a safety filter without an explicit block reason.
  const textPart = json.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text
  throw new Error(
    textPart
      ? `Gemini gaf geen image terug (mogelijk safety filter): "${textPart.slice(0, 200)}"`
      : "Gemini gaf geen image terug. Pas de prompt aan of probeer opnieuw.",
  )
}

/** Fetch a public image URL (e.g., Meta's `thumbnailUrl` on
 *  MetaAdDetail) and return raw bytes + mime — suitable to pass as a
 *  reference image to generateImageWithReference. */
export async function fetchReferenceImage(
  url: string,
): Promise<{ bytes: Buffer; mimeType: "image/jpeg" | "image/png" } | null> {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const arrayBuffer = await res.arrayBuffer()
    const mimeHeader = res.headers.get("content-type") ?? ""
    const mimeType: "image/jpeg" | "image/png" =
      mimeHeader.includes("png") ? "image/png" : "image/jpeg"
    return { bytes: Buffer.from(arrayBuffer), mimeType }
  } catch (e) {
    console.error(
      "[gemini] fetchReferenceImage failed:",
      e instanceof Error ? e.message : e,
    )
    return null
  }
}
