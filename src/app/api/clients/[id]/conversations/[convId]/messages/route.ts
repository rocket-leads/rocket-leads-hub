import { auth } from "@/lib/auth"
import { fetchMessages } from "@/lib/integrations/trengo"
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; convId: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { convId } = await params
  const conversationId = parseInt(convId, 10)
  if (isNaN(conversationId)) {
    return NextResponse.json({ error: "Invalid conversation ID" }, { status: 400 })
  }

  try {
    const messages = await fetchMessages(conversationId)
    return NextResponse.json(messages)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch messages" },
      { status: 500 }
    )
  }
}
