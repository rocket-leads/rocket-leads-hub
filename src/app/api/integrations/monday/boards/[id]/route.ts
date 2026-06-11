import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { resolveMondayBoard } from "@/lib/integrations/monday"

/**
 * GET /api/integrations/monday/boards/[id]
 *
 * Resolves a single Monday board ID to its ResolvedEntity. Used by the
 * always-on verification on the picker trigger - every time a Client
 * Information panel renders, the stored `client_board_id` is round-tripped
 * to confirm the board still exists + the token still has access.
 *
 * Response shape:
 *   - 200 { entity: ResolvedEntity }   - happy path
 *   - 200 { entity: null }             - well-formed ID but board archived/missing (broken link)
 *   - 500                              - Monday transport/auth failure (couldn't verify)
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
    const entity = await resolveMondayBoard(id)
    return NextResponse.json({ entity })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Monday board resolve failed" },
      { status: 500 },
    )
  }
}
