import { auth } from "@/lib/auth"
import { getInboxItem } from "@/lib/inbox/fetchers"
import { toggleReaction } from "@/lib/inbox/reactions"
import { NextRequest, NextResponse } from "next/server"

/**
 * POST /api/inbox/{id}/reactions  body: { emoji: string }
 *
 * Toggles the current user's emoji reaction on an inbox item (add if absent,
 * remove if present). Returns the item's fresh reaction summary. Visibility is
 * enforced via getInboxItem so a user can't react to an item they can't see.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const item = await getInboxItem(id, session.user.id, session.user.role)
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let parsed: { emoji?: string }
  try {
    parsed = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const emoji = parsed.emoji?.trim()
  if (!emoji || emoji.length > 16) {
    return NextResponse.json({ error: "A single emoji is required" }, { status: 400 })
  }

  const reactions = await toggleReaction(id, session.user.id, emoji)
  return NextResponse.json({ reactions })
}
