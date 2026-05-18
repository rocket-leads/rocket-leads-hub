import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

/**
 * Bulk lookup of the most recent client-update timestamp per Monday item.
 *
 * Backs the "Client update" column on the All Clients page: the cell renders
 * a green "Geüpdatet vandaag ✓" state when the timestamp is from today, and
 * a small grey "Laatste update: <date>" caption under the button otherwise.
 *
 * Reads the cached `clients.last_client_update_at` column rather than
 * aggregating `client_updates` on every page load — cheap and indexed.
 *
 * Response shape: see `LastClientUpdatesResponse` below. Monday IDs missing
 * from the map have never been updated; the table cell treats that as
 * "not yet, show the button".
 */

export type LastClientUpdatesResponse = {
  lastUpdates: Record<string, string>
}

export async function GET(_req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const supabase = await createAdminClient()
    const { data, error } = await supabase
      .from("clients")
      .select("monday_item_id, last_client_update_at")
      .not("last_client_update_at", "is", null)

    if (error) {
      console.error("[last-client-updates] read failed:", error.message)
      return NextResponse.json<LastClientUpdatesResponse>({ lastUpdates: {} })
    }

    const lastUpdates: Record<string, string> = {}
    for (const row of data ?? []) {
      if (row.monday_item_id && row.last_client_update_at) {
        lastUpdates[row.monday_item_id as string] = row.last_client_update_at as string
      }
    }

    return NextResponse.json<LastClientUpdatesResponse>(
      { lastUpdates },
      { headers: { "Cache-Control": "private, s-maxage=30, stale-while-revalidate=120" } },
    )
  } catch (e) {
    console.error(
      "[last-client-updates] failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json<LastClientUpdatesResponse>({ lastUpdates: {} })
  }
}
