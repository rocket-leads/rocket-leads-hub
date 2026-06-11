import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { fetchStoredSteps } from "@/lib/clients/onboarding-state"
import { uploadFromUrl } from "@/lib/integrations/google-drive"

// Two image downloads + Drive uploads can take 15-30s on slow CDNs.
export const maxDuration = 60

/**
 * POST /api/clients/[id]/onboarding/save-brand-assets
 *
 * Body: { logoUrl?: string, heroImageUrl?: string }
 *
 * Pulls the klant's logo + hero image straight from their website CDN
 * and drops them into the per-klant Drive folder's `Brief/` subfolder
 * (captured during auto-setup in Stap 1). The AM doesn't have to do
 * anything manually — the Analyze Website button triggers both the
 * brand-fingerprint extraction AND this asset download in parallel.
 *
 * Each URL is best-effort: a failed logo download doesn't block the
 * hero download. Response carries per-asset results so the UI can
 * surface "logo saved, hero failed (404)" instead of an all-or-nothing
 * outcome.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params
  const body = (await req.json()) as {
    logoUrl?: string
    heroImageUrl?: string
  }

  // Resolve the Drive `Brief/` subfolder from kickoff_live step content.
  // Without it, we have nowhere to upload — return early with a clear
  // message so the AM knows auto-setup hasn't finished yet.
  const stored = await fetchStoredSteps(mondayItemId)
  const kickoff = stored.get("kickoff_live")?.content as
    | {
        autoSetup?: {
          drive?: { subfolders?: Record<string, { id: string }> }
        }
      }
    | null
    | undefined
  const briefFolderId =
    kickoff?.autoSetup?.drive?.subfolders?.brief?.id ?? null
  if (!briefFolderId) {
    return NextResponse.json(
      {
        error:
          "Brief subfolder ID not yet captured — wait for auto-setup to finish in Stap 1, then retry.",
      },
      { status: 400 },
    )
  }

  type AssetResult = {
    saved: boolean
    fileId?: string
    fileName?: string
    webViewLink?: string
    error?: string
  }

  // Helper: try to extract a sensible filename from the URL path; fall
  // back to the provided default. Strips query strings (CDNs often
  // hang `?v=...` cache busters off the end).
  const fileNameFromUrl = (url: string, fallback: string): string => {
    try {
      const u = new URL(url)
      const last = u.pathname.split("/").filter(Boolean).pop() ?? ""
      if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last
      return fallback
    } catch {
      return fallback
    }
  }

  const trySave = async (
    url: string | undefined,
    fallbackName: string,
  ): Promise<AssetResult> => {
    if (!url) return { saved: false, error: "no URL provided" }
    try {
      const file = await uploadFromUrl({
        folderId: briefFolderId,
        url,
        fileName: fileNameFromUrl(url, fallbackName),
      })
      return {
        saved: true,
        fileId: file.id,
        fileName: file.name,
        webViewLink: file.webViewLink,
      }
    } catch (e) {
      return {
        saved: false,
        error: e instanceof Error ? e.message : "Upload failed",
      }
    }
  }

  const [logo, hero] = await Promise.all([
    trySave(body.logoUrl, "logo.png"),
    trySave(body.heroImageUrl, "hero.jpg"),
  ])

  return NextResponse.json({
    ok: true,
    logo,
    hero,
  })
}
