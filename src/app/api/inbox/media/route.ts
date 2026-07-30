import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { fetchTrengoMedia, isAllowedTrengoMediaUrl } from "@/lib/integrations/trengo"

/**
 * GET /api/inbox/media?url=<trengo attachment url>
 *
 * Streaming proxy for inbox media (WhatsApp photo/video/voice memo, email
 * attachments). The chat pane points <img>/<video>/<audio>/<a> at this route
 * instead of Trengo directly, so:
 *   - the Trengo token stays server-side (some attachment URLs are auth-gated),
 *   - we sidestep CORS / the artifact-style CSP that would block cross-host
 *     media, and cope with short-lived signed URLs,
 *   - we can cache.
 *
 * SSRF guard: only https URLs on Trengo's own hosts / their storage buckets are
 * proxied (isAllowedTrengoMediaUrl). Anything else 400s.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = req.nextUrl.searchParams.get("url")
  if (!url || !isAllowedTrengoMediaUrl(url)) {
    return NextResponse.json({ error: "Invalid or disallowed media url" }, { status: 400 })
  }

  try {
    const upstream = await fetchTrengoMedia(url)
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `Upstream media fetch failed (${upstream.status})` },
        { status: 502 },
      )
    }
    const headers = new Headers()
    const contentType = upstream.headers.get("content-type")
    if (contentType) headers.set("content-type", contentType)
    const contentLength = upstream.headers.get("content-length")
    if (contentLength) headers.set("content-length", contentLength)
    // Media for a given message never changes; cache hard (private — it's
    // behind auth). Roy 2026-07-30.
    headers.set("cache-control", "private, max-age=86400, immutable")
    return new NextResponse(upstream.body, { status: 200, headers })
  } catch (e) {
    console.error("[inbox/media] proxy failed:", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "Media proxy error" }, { status: 502 })
  }
}
