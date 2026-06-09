import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import {
  generateImageWithReference,
  fetchReferenceImage,
  DEFAULT_IMAGE_MODEL,
} from "@/lib/integrations/gemini"
import { uploadVariantImage, getVariantImageSignedUrl } from "@/lib/integrations/pedro-image-storage"

/**
 * POST /api/pedro/variants/[id]/generate-image
 *  body: { promptOverride?: string }
 *
 * Generates an image for one variant via Gemini Nano Banana Pro using
 * the winning ad's thumbnail as a reference + the variant's
 * `image_prompt`. Stores the result in Supabase Storage and stamps the
 * variant row.
 *
 * Idempotent in spirit: re-running replaces the previous image (the
 * Storage helper cleans up the old path before writing the new one).
 * That matches the "regenereer" UX — clicking the button again should
 * give a fresh take, not append.
 *
 * Roy 2026-06-09.
 */

export const maxDuration = 60 // Gemini image gen routinely takes 5-20s; cap at 60 for safety

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: variantId } = await params

  let body: { promptOverride?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* empty body is fine */
  }

  try {
    const supabase = await createAdminClient()

    const { data: variantRow, error: readErr } = await supabase
      .from("pedro_variants")
      .select(
        "id, client_id, refresh_id, image_prompt, ad_name, format_hint",
      )
      .eq("id", variantId)
      .maybeSingle()
    if (readErr) throw readErr
    if (!variantRow) {
      return NextResponse.json({ error: "Variant not found" }, { status: 404 })
    }

    const prompt = (body.promptOverride?.trim() || variantRow.image_prompt?.trim() || "").trim()
    if (!prompt) {
      return NextResponse.json(
        { error: "Geen imagePrompt op deze variant. Genereer eerst de refresh opnieuw of geef een prompt override." },
        { status: 400 },
      )
    }

    // Resolve the reference image: the basedOnAd's thumbnail from the
    // refresh envelope. We need the refresh row to find which winner
    // this variant iterates on.
    let referenceImageBytes: Buffer | null = null
    let referenceMime: "image/jpeg" | "image/png" = "image/jpeg"
    try {
      const { data: refresh } = await supabase
        .from("pedro_refreshes")
        .select("envelope")
        .eq("id", variantRow.refresh_id)
        .maybeSingle()
      type RefreshEnv = {
        envelope?: {
          proposals?: Array<{
            basedOnAd?: { adId?: string; adName?: string }
            variants?: Array<{ adName?: string }>
          }>
        }
      }
      const envelope = (refresh as RefreshEnv | null)?.envelope
      // Find the proposal containing this variant's adName, then pull the
      // winner adId, then look up the live thumbnail.
      const proposal = envelope?.proposals?.find((p) =>
        p.variants?.some((v) => v.adName === variantRow.ad_name),
      )
      const winnerAdId = proposal?.basedOnAd?.adId
      if (winnerAdId) {
        // Try the Meta /act_X/ads thumbnail URL we may have stashed in
        // the envelope — refresh-naming.ts didn't, so we re-fetch.
        // Pulling a single ad's thumbnail is cheap.
        const { fetchMetaAdDetails } = await import("@/lib/integrations/meta")
        const { data: clientRow } = await supabase
          .from("clients")
          .select("meta_ad_account_id")
          .eq("monday_item_id", variantRow.client_id)
          .maybeSingle()
        if (clientRow?.meta_ad_account_id) {
          // Window of 90d is generous — we just need the ad's metadata,
          // not fresh perf.
          const end = new Date().toISOString().slice(0, 10)
          const startD = new Date()
          startD.setDate(startD.getDate() - 90)
          const start = startD.toISOString().slice(0, 10)
          const ads = await fetchMetaAdDetails(
            clientRow.meta_ad_account_id,
            start,
            end,
          ).catch(() => [])
          const match = ads.find((a) => a.adId === winnerAdId)
          if (match?.thumbnailUrl) {
            const ref = await fetchReferenceImage(match.thumbnailUrl)
            if (ref) {
              referenceImageBytes = ref.bytes
              referenceMime = ref.mimeType
            }
          }
        }
      }
    } catch (e) {
      // Reference lookup is best-effort. If it fails we still try
      // image-gen prompt-only — Gemini handles both modes.
      console.error(
        "[pedro/generate-image] reference fetch failed (continuing):",
        e instanceof Error ? e.message : e,
      )
    }

    let result
    try {
      result = await generateImageWithReference({
        prompt,
        referenceImages: referenceImageBytes
          ? [{ bytes: referenceImageBytes, mimeType: referenceMime }]
          : undefined,
        aspectRatio: variantRow.format_hint === "Video" ? "9:16" : "1:1",
      })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Image generation failed" },
        { status: 502 },
      )
    }

    const uploaded = await uploadVariantImage({
      clientId: variantRow.client_id,
      variantId: variantRow.id,
      bytes: result.bytes,
      contentType: result.mimeType,
      width: result.width,
      height: result.height,
    })

    const { error: updateErr } = await supabase
      .from("pedro_variants")
      .update({
        image_storage_path: uploaded.storagePath,
        image_provider: "gemini",
        image_model: result.model,
        image_generated_at: new Date().toISOString(),
        image_width: uploaded.width,
        image_height: uploaded.height,
        // Persist the prompt override so subsequent regens use the
        // edited version by default.
        ...(body.promptOverride?.trim() ? { image_prompt: body.promptOverride.trim() } : {}),
      })
      .eq("id", variantRow.id)
    if (updateErr) throw updateErr

    const signedUrl = await getVariantImageSignedUrl(uploaded.storagePath)

    return NextResponse.json({
      variantId: variantRow.id,
      storagePath: uploaded.storagePath,
      signedUrl,
      provider: "gemini",
      model: result.model || DEFAULT_IMAGE_MODEL,
      hadReference: referenceImageBytes !== null,
    })
  } catch (e) {
    console.error(
      "[pedro/generate-image] failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Image generation failed" },
      { status: 500 },
    )
  }
}
