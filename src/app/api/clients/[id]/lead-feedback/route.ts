import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchClientBoardItemsWithUpdates } from "@/lib/integrations/monday"
import { NextRequest, NextResponse } from "next/server"

export type UtmFeedback = {
  utm: string
  totalLeads: number
  leadsWithUpdates: number
  updates: Array<{ itemName: string; text: string; createdAt: string; leadStatus: string }>
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const { searchParams } = req.nextUrl
  const clientBoardIdParam = searchParams.get("clientBoardId") ?? ""

  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("monday_client_board_id")
    .eq("monday_item_id", mondayItemId)
    .single()

  const clientBoardId = client?.monday_client_board_id ?? clientBoardIdParam
  if (!clientBoardId) {
    return NextResponse.json({ feedback: [] })
  }

  const items = await fetchClientBoardItemsWithUpdates(clientBoardId).catch((e) => {
    console.error("Monday updates fetch error:", e)
    return []
  })

  // Group updates by UTM — only include items that have updates
  const utmMap = new Map<string, UtmFeedback>()
  for (const item of items) {
    const utm = item.utm || "(no UTM)"

    if (!utmMap.has(utm)) {
      utmMap.set(utm, { utm, totalLeads: 0, leadsWithUpdates: 0, updates: [] })
    }
    const row = utmMap.get(utm)!
    row.totalLeads++

    if (item.updates.length > 0) {
      row.leadsWithUpdates++
      for (const update of item.updates) {
        if (update.text.trim()) {
          row.updates.push({
            itemName: item.itemName,
            text: update.text,
            createdAt: update.createdAt,
            leadStatus: item.leadStatus,
          })
        }
      }
    }
  }

  const feedback = Array.from(utmMap.values())
    .filter((r) => r.updates.length > 0)
    .sort((a, b) => b.totalLeads - a.totalLeads)

  return NextResponse.json(
    { feedback },
    { headers: { "Cache-Control": "private, s-maxage=120, stale-while-revalidate=300" } },
  )
}
