import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * One-shot cleanup: delete outbound mirror rows that lost their dedupe race
 * with Trengo's OUTBOUND webhook. Targets `inbox_events` rows where:
 *   - source = 'trengo'
 *   - source_msg_id = 'trengo:msg:'  (mirror row inserted before Trengo's
 *     send-response shape was correctly parsed → message_id missing)
 *   - classify_method = 'manual'     (mirror inserts use 'manual'; webhook
 *     ingests use 'ai' so we don't risk killing real ingests)
 *
 * Idempotent. Admin-only. Drop after the dedup is verified clean.
 */
export async function POST() {
  return run()
}

export async function GET() {
  return run()
}

async function run() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const supabase = await createAdminClient()

  const { data: candidates } = await supabase
    .from("inbox_events")
    .select("id, title, source_msg_id, classify_method, created_at")
    .eq("source", "trengo")
    .eq("source_msg_id", "trengo:msg:")
    .eq("classify_method", "manual")

  const ids = (candidates ?? []).map((r) => r.id)
  if (ids.length === 0) {
    return NextResponse.json({ deleted: 0, scanned: 0 })
  }

  const { error } = await supabase.from("inbox_events").delete().in("id", ids)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    deleted: ids.length,
    rows: candidates ?? [],
  })
}
