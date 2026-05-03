import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { MEETING_ROW_COLUMNS, type MeetingRow } from "@/lib/meetings/types"

/**
 * Fetch all meetings linked to this client. Caller passes the Monday item ID
 * (which is what `meetings.client_id` references). Sorted newest-first.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("meetings")
    .select(MEETING_ROW_COLUMNS)
    .eq("client_id", id)
    .order("scheduled_at", { ascending: false, nullsFirst: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ meetings: (data ?? []) as MeetingRow[] })
}
