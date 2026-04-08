import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createAdminClient()

  const { data } = await supabase
    .from("clients")
    .select("monday_item_id, monday_active")
    .eq("monday_active", true)

  const map: Record<string, boolean> = {}
  for (const row of data ?? []) {
    map[row.monday_item_id] = true
  }

  return NextResponse.json(map)
}
