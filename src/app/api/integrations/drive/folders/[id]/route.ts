import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { resolveDriveFolder } from "@/lib/integrations/google-drive"

/**
 * GET /api/integrations/drive/folders/[id]
 *
 * Resolves a single Drive folder ID to its ResolvedEntity. Used by the
 * always-on verification on the picker trigger — picks up both "ID
 * doesn't exist" and "service account no longer has access" as broken
 * links, plus flags trashed folders loudly so the AM fixes them before
 * Pedro tries to drop a deliverable into the trash.
 *
 * Response shape:
 *   - 200 { entity: ResolvedEntity }   — happy path; `status: "error"` + `In trash` label when the folder is trashed
 *   - 200 { entity: null }             — well-formed ID but not a folder, or service account has no access
 *   - 500                              — Drive transport/auth failure (couldn't verify)
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
    const entity = await resolveDriveFolder(id)
    return NextResponse.json({ entity })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Drive folder resolve failed" },
      { status: 500 },
    )
  }
}
