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
    const { data: row, error } = await supabase
      .from("pedro_variants")
      .select(
        "image_storage_path, image_provider, image_model, image_generated_at, image_prompt",
      )
      .eq("id", variantId)
      .maybeSingle()
    if (error) throw error
    if (!row) return NextResponse.json({ error: "Variant not found" }, { status: 404 })

    if (!row.image_storage_path) {
      return NextResponse.json({
        hasImage: false,
        imagePrompt: row.image_prompt ?? null,
      })
    }

    const signedUrl = await getVariantImageSignedUrl(row.image_storage_path)
    return NextResponse.json({
      hasImage: true,
      signedUrl,
      provider: row.image_provider,
      model: row.image_model,
      generatedAt: row.image_generated_at,
      imagePrompt: row.image_prompt ?? null,
    })
  } catch (e) {
    console.error("[pedro/variant-image] failed:", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load image" },
      { status: 500 },
    )
  }
}
