import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const supabase = await createAdminClient()

  const { data } = await supabase
    .from("clients")
    .select("monday_active")
    .eq("monday_item_id", mondayItemId)
    .single()

  return NextResponse.json({ mondayActive: data?.monday_active ?? false })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const { mondayActive } = await req.json() as { mondayActive: boolean }

  const supabase = await createAdminClient()

  const { error } = await supabase
    .from("clients")
    .update({ monday_active: mondayActive })
    .eq("monday_item_id", mondayItemId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ mondayActive })
}
