import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { filterClientsByUser } from "@/lib/clients/filter"
import type { EditableParts } from "@/lib/clients/client-update-template"
import { NextResponse } from "next/server"

/**
 * List pending weekly-update drafts visible to the current user.
 *
 * Used by the /clients overview banner ("5 wekelijkse updates te verzenden")
 * and the queue overlay that lets the AM jump into each draft via the
 * existing Client Update dialog.
 *
 * Visibility model mirrors filterClientsByUser:
 *   - admin / finance → all pending drafts
 *   - AM/CM/Setter mapping → only drafts for clients where this user is
 *     mapped (matches the /clients overview scope)
 *   - no mappings → all drafts (no restriction)
 *
 * Sort: newest first (typical week is one batch from Monday's cron, so this
 * lands them in client-creation order). Caller can re-sort client-side.
 */

export type WeeklyUpdateDraftListItem = {
  id: string
  clientId: string
  mondayItemId: string
  clientName: string
  weekOf: string
  parts: EditableParts
  templateVersion: 1 | 2
  templateName: string | null
  channel: "whatsapp" | "email" | "unknown"
  status: "pending" | "sent" | "dismissed"
  createdAt: string
}

export type WeeklyUpdateDraftListResponse = {
  drafts: WeeklyUpdateDraftListItem[]
  /** Total count (same as drafts.length here, but reserved for paging). */
  count: number
}

type DraftRow = {
  id: string
  client_id: string
  monday_item_id: string
  week_of: string
  parts: EditableParts
  template_version: number
  template_name: string | null
  channel: string
  status: "pending" | "sent" | "dismissed"
  created_at: string
  // Supabase typed FK join: returns `clients` as an array even for 1-to-1
  // relations. We just need `name`; collapse to the first row in the map.
  clients: Array<{ name: string | null }> | null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createAdminClient()

  // Pull pending drafts with the client's display name in one round-trip.
  // We always cap at 500 here — the banner only needs a count and a small
  // list to render the queue; if the cron ever produces more we'll page.
  const { data, error } = await supabase
    .from("weekly_update_drafts")
    .select(
      "id, client_id, monday_item_id, week_of, parts, template_version, template_name, channel, status, created_at, clients ( name )",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(500)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Filter by user visibility. We do this client-side (in the route, not
  // SQL) because the access rules live in filterClientsByUser and join
  // against the Monday board cache — not the supabase clients table.
  const cached = await readCache<{ current: MondayClient[] }>("monday_boards")
  const boards = cached ?? (await fetchBothBoards())
  const role = (session.user.role as string | undefined) ?? "user"
  const visible = await filterClientsByUser(boards.current, session.user.id, role)
  const visibleIds = new Set(visible.map((c) => c.mondayItemId))

  const rows = (data ?? []) as DraftRow[]
  const drafts: WeeklyUpdateDraftListItem[] = rows
    .filter((r) => visibleIds.has(r.monday_item_id))
    .map((r) => ({
      id: r.id,
      clientId: r.client_id,
      mondayItemId: r.monday_item_id,
      clientName: r.clients?.[0]?.name ?? r.monday_item_id,
      weekOf: r.week_of,
      parts: r.parts,
      templateVersion: (r.template_version === 2 ? 2 : 1) as 1 | 2,
      templateName: r.template_name,
      channel: (r.channel as "whatsapp" | "email" | "unknown") ?? "unknown",
      status: r.status,
      createdAt: r.created_at,
    }))

  return NextResponse.json<WeeklyUpdateDraftListResponse>({
    drafts,
    count: drafts.length,
  })
}
