import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  uploadAdSourceScreenshot,
  deleteAdSourceScreenshot,
} from "@/lib/integrations/pedro-image-storage"

/**
 * Per-ad manual screenshot upload.
 *
 * Roy 2026-06-10: Meta retourneert lang niet altijd een thumbnail voor
 * elke ad (vooral dynamic creatives). CM uploadt zelf een screenshot
 * van die ad, en Pedro gebruikt 'm als reference image bij image
 * generation ipv de ontbrekende winner thumbnail.
 *
 * POST  multipart upload (form field `file`)
 * DELETE removes the screenshot
 *
 * Path layout: `<clientId>/ad-source/<adId>.<ext>` in the existing
 * pedro-ad-images bucket. Re-upload overschrijft de vorige.
 */

const MAX_BYTES = 20 * 1024 * 1024 // 20 MB - generous; Meta caps lower anyway

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string; adId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { clientId, adId } = await params
  if (!clientId || !adId) {
    return NextResponse.json(
      { error: "clientId en adId zijn verplicht" },
      { status: 400 },
    )
  }

  try {
    const formData = await req.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Geen 'file' veld in de upload" },
        { status: 400 },
      )
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
    const arrayBuffer = await file.arrayBuffer()
    const bytes = Buffer.from(arrayBuffer)

    const { storagePath } = await uploadAdSourceScreenshot({
      clientId,
      adId,
      bytes,
      contentType: mime,
    })

    return NextResponse.json({
      ok: true,
      adId,
      clientId,
      storagePath,
    })
  } catch (e) {
    console.error(
      "[ad-source-screenshot POST] failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string; adId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { clientId, adId } = await params
  if (!clientId || !adId) {
    return NextResponse.json(
      { error: "clientId en adId zijn verplicht" },
      { status: 400 },
    )
  }
  await deleteAdSourceScreenshot({ clientId, adId })
  return NextResponse.json({ ok: true, deleted: true })
}
