import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { resolveTrengoContact } from "@/lib/integrations/trengo"

/**
 * GET /api/integrations/trengo/contacts/[id]
 *
 * Resolves a single Trengo contact ID to its ResolvedEntity. Used by the
 * always-on verification on the picker trigger — without this, a typo'd
 * trengo_contact_id silently breaks the per-client Inbox + Timeline tabs
 * with no visible signal in the panel, which Roy flagged as the worst of
 * the five identifier blind spots.
 *
 * Response shape:
 *   - 200 { entity: ResolvedEntity }   — happy path
 *   - 200 { entity: null }             — well-formed ID but no such contact, or contact archived (broken link)
 *   - 500                              — Trengo transport/auth failure (couldn't verify)
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
    const entity = await resolveTrengoContact(id)
    return NextResponse.json({ entity })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Trengo contact resolve failed" },
      { status: 500 },
    )
  }
}
