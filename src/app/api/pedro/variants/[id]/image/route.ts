import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { getVariantImageSignedUrl } from "@/lib/integrations/pedro-image-storage"

/**
 * GET /api/pedro/variants/[id]/image
 *
 * Returns a fresh signed URL for the variant's stored image so the UI
 * can render the preview. Signed URLs expire (~1h) so the UI fetches
 * this lazily and re-fetches when the URL is older than ~50 min.
 *
 * Response:
 *   - 200 { signedUrl, provider, model, generatedAt, hasImage: true }
 *   - 200 { hasImage: false } when no image has been generated yet
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: variantId } = await params

  try {
    const supabase = await createAdminClient()
    const { data: variantRow, error: vErr } = await supabase
      .from("pedro_variants")
      .select("id, image_prompt, hook, primary_copy_snippet")
      .eq("id", variantId)
      .maybeSingle<{
        id: string
        image_prompt: string | null
        hook: string | null
        primary_copy_snippet: string | null
      }>()
    if (vErr) throw vErr
    if (!variantRow) return NextResponse.json({ error: "Variant not found" }, { status: 404 })

    // Pull all slots for this variant. Even slots that haven't been
    // generated yet count — the UI shows empty slots so the CM knows
    // they can fill them.
    const { data: slotRows, error: sErr } = await supabase
      .from("pedro_variant_images")
      .select("position, storage_path, provider, model, generated_at, regen_count")
      .eq("variant_id", variantId)
      .order("position", { ascending: true })
    if (sErr) throw sErr

    type SlotRow = {
      position: number
      storage_path: string | null
      provider: string | null
      model: string | null
      generated_at: string | null
      regen_count: number | null
    }

    const signedSlots = await Promise.all(
      ((slotRows ?? []) as SlotRow[]).map(async (s) => {
        const signedUrl = s.storage_path
          ? await getVariantImageSignedUrl(s.storage_path)
          : null
        const regenCount = s.regen_count ?? 0
        return {
          position: s.position,
          hasImage: !!s.storage_path,
          signedUrl,
          provider: s.provider,
          model: s.model,
          generatedAt: s.generated_at,
          regenCount,
          // Roy 2026-06-10: max 1 regen per slot. UI shows the budget
          // so the CM knows up front whether the Regen button works.
          regenAvailable: regenCount < 1,
        }
      }),
    )

    return NextResponse.json({
      hasAnyImage: signedSlots.some((s) => s.hasImage),
      slots: signedSlots,
      imagePrompt: variantRow.image_prompt,
      hook: variantRow.hook,
      primaryCopySnippet: variantRow.primary_copy_snippet,
    })
  } catch (e) {
    console.error("[pedro/variant-image] failed:", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load image" },
      { status: 500 },
    )
  }
}
