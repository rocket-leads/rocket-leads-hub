import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import {
  generateImageWithReference,
  fetchReferenceImage,
  DEFAULT_IMAGE_MODEL,
} from "@/lib/integrations/gemini"
import { uploadVariantImage, getVariantImageSignedUrl } from "@/lib/integrations/pedro-image-storage"
import { getFolderImages, type DriveImageRef } from "@/lib/integrations/google-drive"
import { rerankDrivePhotos } from "@/lib/pedro/drive-photo-vision"
import { resolveVisualStylePolicy } from "@/lib/pedro/visual-style-policy"
import type { BrandStyle } from "@/lib/pedro/helpers"

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

  let body: {
    promptOverride?: string
    /** When set: generate just this slot. Default = all 3 slots. */
    position?: number
    /** Override how many slots to fill when position omitted.
     *  Default 3, max 10 (matches the CHECK on pedro_variant_images). */
    slots?: number
  } = {}
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
        "id, client_id, refresh_id, image_prompt, ad_name, format_hint, topic_label",
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

    // Resolve reference images. Two sources, both best-effort:
    //   1. Winner ad thumbnail from Meta — DNA the CM already validated
    //   2. Client photos from Google Drive — real product/brand
    //      visuals so Gemini doesn't hallucinate the look-and-feel
    //
    // Gemini Nano Banana Pro accepts up to 3 reference images; we cap
    // at: 1 winner thumbnail + 2 client photos = 3 total. When Drive
    // is empty we fall back to just the winner thumbnail; when even
    // that fails we go prompt-only (Gemini handles that mode too).
    //
    // Both lookups run in parallel — Drive's recurse-one-level can
    // take 2-5s on big folders and there's no reason to serialize.

    type Ref = { bytes: Buffer; mimeType: "image/jpeg" | "image/png" }

    // Capture into a non-null const so the closures below don't need
    // type narrowing across the async boundary (TS doesn't carry the
    // earlier null-guard into nested function scope).
    const variant = variantRow

    // ── Resolve winner Meta ad details ─────────────────────────────
    // We need this BEFORE the Drive call so we can pass the winner's
    // campaign name as `campaignHint` — that's what makes Pedro pick
    // the right sub-folder under a multi-campaign umbrella (e.g.,
    // "Zumex" under "Juice Concepts Benelux" instead of Blendtec).
    async function resolveWinnerDetail(): Promise<{
      thumbnailUrl: string | null
      campaignName: string | null
    } | null> {
      try {
        const { data: refresh } = await supabase
          .from("pedro_refreshes")
          .select("envelope")
          .eq("id", variant.refresh_id)
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
        const proposal = envelope?.proposals?.find((p) =>
          p.variants?.some((v) => v.adName === variant.ad_name),
        )
        const winnerAdId = proposal?.basedOnAd?.adId
        if (!winnerAdId) return null

        const { fetchMetaAdDetails } = await import("@/lib/integrations/meta")
        const { data: clientRow } = await supabase
          .from("clients")
          .select("meta_ad_account_id")
          .eq("monday_item_id", variant.client_id)
          .maybeSingle()
        if (!clientRow?.meta_ad_account_id) return null

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
        if (!match) return null

        return {
          thumbnailUrl: match.thumbnailUrl ?? null,
          campaignName: match.campaignName ?? null,
        }
      } catch (e) {
        console.error(
          "[pedro/generate-image] winner detail resolve failed (continuing):",
          e instanceof Error ? e.message : e,
        )
        return null
      }
    }

    const winnerDetail = await resolveWinnerDetail()
    const winnerCampaignName = winnerDetail?.campaignName ?? null

    async function fetchWinnerThumbRef(): Promise<Ref | null> {
      const url = winnerDetail?.thumbnailUrl
      if (!url) return null
      try {
        const ref = await fetchReferenceImage(url)
        return ref ? { bytes: ref.bytes, mimeType: ref.mimeType } : null
      } catch (e) {
        console.error(
          "[pedro/generate-image] winner-thumb fetch failed (continuing):",
          e instanceof Error ? e.message : e,
        )
        return null
      }
    }

    async function fetchDrivePhotoRefs(): Promise<DriveImageRef[]> {
      try {
        const { fetchClientById } = await import("@/lib/integrations/monday")
        const mondayClient = await fetchClientById(variant.client_id).catch(() => null)
        const driveId = mondayClient?.googleDriveId?.trim()
        if (!driveId) return []
        // Topic hints from the variant: ad-name + topic_label drive the
        // filename-keyword scoring so we pick photos relevant to THIS
        // variant's angle, not just the most recent file in the folder.
        const topicHints = [variant.topic_label, variant.ad_name].filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        )
        return await getFolderImages(driveId, 2, {
          campaignHint: winnerCampaignName ?? undefined,
          topicHints,
          // Vision rerank: Haiku describes each candidate photo (cached
          // by file_id), then ranks them against the campaign + variant
          // angle. Lets Pedro "zelf nadenken" over fotokeuze instead of
          // blindly trusting folder-score order.
          rerank: async (candidates) =>
            rerankDrivePhotos(
              supabase,
              candidates,
              {
                campaignName: winnerCampaignName,
                topicLabel: variant.topic_label,
                adName: variant.ad_name,
              },
              variant.client_id,
            ),
        })
      } catch (e) {
        console.error(
          "[pedro/generate-image] drive-photos fetch failed (continuing):",
          e instanceof Error ? e.message : e,
        )
        return []
      }
    }

    // Resolve the visual-style policy from the CM's brief + the scraped
    // fingerprint quality. Roy 2026-06-10: this is what makes the
    // "Match Drive folder only" / "Match winning ad only" / "Custom
    // prompt" modes in the brief actually do something at image-gen
    // time. Without it, Pedro always used every reference it could
    // find regardless of the CM's intent.
    const { data: stateRow } = await supabase
      .from("pedro_client_state")
      .select("brief, brand_style")
      .eq("client_id", variant.client_id)
      .order("campaign_number", { ascending: false })
      .limit(1)
      .maybeSingle<{
        brief: Record<string, unknown> | null
        brand_style: Record<string, unknown> | null
      }>()
    const briefForPolicy = (stateRow?.brief ?? null) as Record<string, unknown> | null
    const brandStyleForPolicy = (stateRow?.brand_style ?? null) as Partial<BrandStyle> | null
    const policy = resolveVisualStylePolicy(
      briefForPolicy
        ? {
            visualStyleMode:
              briefForPolicy.visualStyleMode === "drive_only" ||
              briefForPolicy.visualStyleMode === "winning_ad_only" ||
              briefForPolicy.visualStyleMode === "custom"
                ? briefForPolicy.visualStyleMode
                : "website",
            customStylePrompt:
              typeof briefForPolicy.customStylePrompt === "string"
                ? briefForPolicy.customStylePrompt
                : "",
            websiteToggles: briefForPolicy.websiteToggles as
              | { useColors: boolean; useFonts: boolean; useLookFeel: boolean; useLogo: boolean }
              | undefined,
            fallbackFontHeading:
              briefForPolicy.fallbackFontHeading === "manrope" ||
              briefForPolicy.fallbackFontHeading === "plus_jakarta"
                ? briefForPolicy.fallbackFontHeading
                : "inter",
          }
        : null,
      brandStyleForPolicy as BrandStyle | null,
    )

    // Fetch refs in parallel — but skip the call entirely when the
    // policy says we won't use that source. Cuts the Meta + Drive
    // round-trips when they're going to be thrown away anyway.
    const [winnerThumbRef, drivePhotoRefs] = await Promise.all([
      policy.referenceImagePolicy.useWinnerThumbnail ? fetchWinnerThumbRef() : Promise.resolve(null),
      policy.referenceImagePolicy.useDrivePhotos ? fetchDrivePhotoRefs() : Promise.resolve([]),
    ])

    const referenceImages: Ref[] = []
    if (winnerThumbRef) referenceImages.push(winnerThumbRef)
    for (const p of drivePhotoRefs) {
      referenceImages.push({ bytes: p.bytes, mimeType: p.mimeType })
    }

    console.log(
      `[pedro/generate-image] refs for ${variant.id}: campaign="${winnerCampaignName ?? "(unknown)"}", winner=${winnerThumbRef ? "yes" : "no"}, drive=${drivePhotoRefs.length}${drivePhotoRefs.length > 0 ? ` (${drivePhotoRefs.map((p) => p.name).join(", ")})` : ""}, policy={winner:${policy.referenceImagePolicy.useWinnerThumbnail},drive:${policy.referenceImagePolicy.useDrivePhotos},notice:${policy.notice ? "yes" : "no"}}`,
    )

    // Resolve target slots. Default: generate ALL 3 slots in parallel
    // so the CM gets a 3-up to pick from. When `position` is set: only
    // that slot (used by "Regenereer slot N" in the UI). Each Gemini
    // call gets its own randomization via a slot-index hint in the
    // prompt so we don't get 3 identical outputs.
    let targetSlots: number[] = []
    if (typeof body.position === "number") {
      const p = Math.max(0, Math.min(9, Math.floor(body.position)))
      targetSlots = [p]
    } else {
      const n = Math.max(1, Math.min(10, Math.floor(body.slots ?? 3)))
      targetSlots = Array.from({ length: n }, (_, i) => i)
    }

    const aspectRatio = variant.format_hint === "Video" ? "9:16" : "1:1"

    // Generate all targets in parallel. Each variation gets a small
    // delta in the prompt so Gemini doesn't return near-duplicates.
    const slotResults = await Promise.allSettled(
      targetSlots.map((slot) => {
        const variationHint = targetSlots.length > 1
          ? `\n\nVariation focus for this output (#${slot + 1} of ${targetSlots.length}): ${["lead with the product/subject in close-up", "emphasize the environment/setting around the subject", "balance product and people, lifestyle angle"][slot] ?? "fresh angle, different composition than the others"}.`
          : ""
        return generateImageWithReference({
          prompt: prompt + variationHint,
          referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
          aspectRatio,
        })
      }),
    )

    // Upload + persist per successful generation; collect errors for
    // partial-failure reporting (UI shows "2/3 succeeded").
    type SlotState = {
      position: number
      ok: boolean
      signedUrl?: string
      storagePath?: string
      provider?: "gemini"
      model?: string
      error?: string
    }
    const slotStates: SlotState[] = []
    for (let i = 0; i < targetSlots.length; i++) {
      const slot = targetSlots[i]
      const r = slotResults[i]
      if (r.status === "rejected") {
        slotStates.push({
          position: slot,
          ok: false,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        })
        continue
      }
      try {
        const uploaded = await uploadVariantImage({
          clientId: variant.client_id,
          variantId: variant.id,
          position: slot,
          bytes: r.value.bytes,
          contentType: r.value.mimeType,
          width: r.value.width,
          height: r.value.height,
        })

        await supabase
          .from("pedro_variant_images")
          .upsert(
            {
              variant_id: variant.id,
              position: slot,
              storage_path: uploaded.storagePath,
              provider: "gemini",
              model: r.value.model,
              generated_at: new Date().toISOString(),
              width: uploaded.width,
              height: uploaded.height,
            },
            { onConflict: "variant_id,position" },
          )

        const signedUrl = await getVariantImageSignedUrl(uploaded.storagePath)
        slotStates.push({
          position: slot,
          ok: true,
          signedUrl: signedUrl ?? undefined,
          storagePath: uploaded.storagePath,
          provider: "gemini",
          model: r.value.model,
        })
      } catch (e) {
        slotStates.push({
          position: slot,
          ok: false,
          error: e instanceof Error ? e.message : "Upload/persist failed",
        })
      }
    }

    // Persist the prompt override on the variant row so subsequent
    // regens (any slot) reuse the edited prompt by default. Also log
    // it as a feedback signal so the next creative-refresh prompt sees
    // what this CM wanted changed — the feedback loop that closes the
    // iterative knowledge-gap per knowledge/campaigns.md §Image Creative
    // Principles #5.
    if (body.promptOverride?.trim()) {
      const newPrompt = body.promptOverride.trim()
      const previous = variant.image_prompt ?? ""
      await supabase
        .from("pedro_variants")
        .update({ image_prompt: newPrompt })
        .eq("id", variant.id)
      // Only log the edit when it's a real change, not a re-submit of
      // the same text. Cap the stored text — for prompt edits we keep
      // the new version (it's the signal of where the CM steered).
      if (newPrompt !== previous.trim()) {
        try {
          await supabase.from("pedro_creative_feedback").insert({
            client_id: variant.client_id,
            variant_id: variant.id,
            refresh_id: variant.refresh_id,
            feedback_type: "prompt_edit",
            feedback_text: `[Prompt edit op variant "${variant.ad_name ?? ""}"]\n${newPrompt.slice(0, 1500)}`,
            created_by_email: session.user.email ?? null,
          })
        } catch (e) {
          console.error(
            "[pedro/generate-image] feedback log failed (continuing):",
            e instanceof Error ? e.message : e,
          )
        }
      }
    }

    // If literally every slot failed, surface the first error as 502
    // so the UI shows the actionable message (quota, billing, etc.).
    const anyOk = slotStates.some((s) => s.ok)
    if (!anyOk) {
      const first = slotStates.find((s) => !s.ok)
      return NextResponse.json(
        { error: first?.error ?? "Image generation failed for all slots", slots: slotStates },
        { status: 502 },
      )
    }

    return NextResponse.json({
      variantId: variant.id,
      slots: slotStates,
      provider: "gemini",
      model: DEFAULT_IMAGE_MODEL,
      // Per-source flags so the UI can show "Generated with: winner
      // thumbnail + 2 client photos" and the CM trusts the output.
      references: {
        winnerThumbnail: winnerThumbRef !== null,
        clientPhotos: drivePhotoRefs.length,
        clientPhotoNames: drivePhotoRefs.map((p) => p.name),
      },
      hadReference: referenceImages.length > 0,
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
