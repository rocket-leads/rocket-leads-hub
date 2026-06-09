import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { resolveMetaAdAccount } from "@/lib/integrations/meta"

/**
 * GET /api/integrations/meta/ad-accounts/[id]
 *
 * Resolves a single Meta ad account ID to its ResolvedEntity. Used by the
 * always-on verification on the picker trigger — catches the "ad account
 * got disabled by Meta but the ID is still set" case that's been silently
 * breaking the Performance Overview for weeks at a time.
 *
 * Response shape:
 *   - 200 { entity: ResolvedEntity }   — happy path
 *   - 200 { entity: null }             — ID is well-formed but no such account, or token has no access (broken link)
 *   - 500                              — Meta transport/auth failure (couldn't verify)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  try {
    const entity = await resolveMetaAdAccount(id)
    return NextResponse.json({ entity })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Meta ad account resolve failed" },
      { status: 500 },
    )
  }
}
