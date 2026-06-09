import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { uploadVariantImage, getVariantImageSignedUrl } from "@/lib/integrations/pedro-image-storage"

/**
 * POST /api/pedro/variants/[id]/upload-image
 *  body: multipart/form-data with `file` field (image/jpeg or image/png)
 *
 * Manual upload override — when the CM has a real client photo / brand
 * asset that beats the AI-generated one, they upload it here and we
 * treat it identically downstream (Meta launch endpoint doesn't care
 * which source produced it).
 *
 * Roy 2026-06-09.
 */

const MAX_BYTES = 30 * 1024 * 1024 // 30 MB — matches Meta's ad-image cap

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: variantId } = await params

  try {
    const formData = await req.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Geen 'file' veld in de upload" }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `Bestand te groot (max ${MAX_BYTES / 1024 / 1024} MB)` },
        { status: 413 },
      )
    }
    const mime = file.type
    if (mime !== "image/jpeg" && mime !== "image/png") {
      return NextResponse.json(
        { error: `Alleen JPEG of PNG. Kreeg: ${mime || "onbekend"}` },
        { status: 400 },
      )
    }

    const supabase = await createAdminClient()
    const { data: variantRow } = await supabase
      .from("pedro_variants")
      .select("id, client_id")
      .eq("id", variantId)
      .maybeSingle()
    if (!variantRow) {
      return NextResponse.json({ error: "Variant not found" }, { status: 404 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const bytes = Buffer.from(arrayBuffer)

    const uploaded = await uploadVariantImage({
      clientId: variantRow.client_id,
      variantId: variantRow.id,
      bytes,
      contentType: mime,
    })

    const { error: updateErr } = await supabase
      .from("pedro_variants")
      .update({
        image_storage_path: uploaded.storagePath,
        image_provider: "manual_upload",
        image_model: null,
        image_generated_at: new Date().toISOString(),
      })
      .eq("id", variantRow.id)
    if (updateErr) throw updateErr

    const signedUrl = await getVariantImageSignedUrl(uploaded.storagePath)

    return NextResponse.json({
      variantId: variantRow.id,
      storagePath: uploaded.storagePath,
      signedUrl,
      provider: "manual_upload",
    })
  } catch (e) {
    console.error(
      "[pedro/upload-image] failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 500 },
    )
  }
}
