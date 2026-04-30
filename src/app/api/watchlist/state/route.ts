import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export type WatchlistClientState = {
  category: "action" | "watch" | "good" | "no-data"
  prevCategory: "action" | "watch" | "good" | "no-data" | null
  /** YYYY-MM-DD — the date this client entered the current category */
  sinceDate: string
}

export type WatchlistStateResponse = Record<string, WatchlistClientState>

/**
 * Returns the per-client Watch List state used to render the days-in-bucket indicator,
 * the NEW badge, and the yesterday-vs-today trend. The cron is the writer; this route
 * is read-only and dirt-cheap (single Supabase query). Returned as a map keyed by
 * monday_item_id so the UI can join in O(1).
 */
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("watchlist_client_state")
    .select("monday_item_id, category, prev_category, since_date")

  if (error) {
    console.error("Watchlist state read failed:", error.message)
    return NextResponse.json<WatchlistStateResponse>({}, { status: 200 })
  }

  const out: WatchlistStateResponse = {}
  for (const row of data ?? []) {
    out[row.monday_item_id] = {
      category: row.category,
      prevCategory: row.prev_category ?? null,
      sinceDate: row.since_date,
    }
  }

  return NextResponse.json(out, {
    headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
  })
}
