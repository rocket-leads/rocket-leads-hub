import { auth } from "@/lib/auth"
import { fetchConversations } from "@/lib/trengo"
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  await params // mondayItemId not needed here, contactId comes from query param

  const trengoContactId = req.nextUrl.searchParams.get("trengoContactId")
  if (!trengoContactId) {
    return NextResponse.json({ error: "No Trengo Contact ID provided." }, { status: 400 })
  }

  try {
    const conversations = await fetchConversations(trengoContactId)
    return NextResponse.json(conversations)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch conversations" },
      { status: 500 }
    )
  }
}
