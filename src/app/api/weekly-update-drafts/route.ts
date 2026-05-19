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
  /** Display name preferred for headers — uses Monday `companyName` when
   *  set (most common), falls back to `name`, finally to the Monday item id. */
  clientName: string
  /** First name of the contact at the client side (e.g. "Rick" from the
   *  draft body). Used in the queue list for quick scanning. */
  contactFirstName: string
  /** Account manager assigned to this client on Monday — shown in the
   *  list so a Roy-as-admin can see whose draft is whose at a glance. */
  accountManager: string
  weekOf: string
  parts: EditableParts
  /** Legacy field — always 2 in the new flow. Kept for backwards-compat. */
  templateVersion: 2
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
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createAdminClient()

  const { data, error } = await supabase
    .from("weekly_update_drafts")
    .select(
      "id, client_id, monday_item_id, week_of, parts, template_version, template_name, channel, status, created_at",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(500)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Pull the Monday board cache once. It's already the authoritative
  // source for client display name, company name, and AM on every other
  // page — using it here keeps the queue's labels consistent with what
  // the AM sees in /clients (vs. the stale clients.name in Supabase,
  // which often lags the Monday rename until the next refresh).
  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
  )
  const boards = cached ?? (await fetchBothBoards())
  const allBoardClients = [...boards.onboarding, ...boards.current]
  const clientByMondayId = new Map<string, MondayClient>()
  for (const c of allBoardClients) clientByMondayId.set(c.mondayItemId, c)

  const role = (session.user.role as string | undefined) ?? "user"
  const visible = await filterClientsByUser(boards.current, session.user.id, role)
  const visibleIds = new Set(visible.map((c) => c.mondayItemId))

  const rows = (data ?? []) as DraftRow[]
  const drafts: WeeklyUpdateDraftListItem[] = rows
    .filter((r) => visibleIds.has(r.monday_item_id))
    .map((r) => {
      const mc = clientByMondayId.get(r.monday_item_id)
      const displayName =
        mc?.companyName?.trim() || mc?.name?.trim() || r.monday_item_id
      return {
        id: r.id,
        clientId: r.client_id,
        mondayItemId: r.monday_item_id,
        clientName: displayName,
        contactFirstName: (mc?.firstName ?? "").trim(),
        accountManager: (mc?.accountManager ?? "").trim(),
        weekOf: r.week_of,
        parts: r.parts,
        templateVersion: 2 as const,
        templateName: r.template_name,
        channel: (r.channel as "whatsapp" | "email" | "unknown") ?? "unknown",
        status: r.status,
        createdAt: r.created_at,
      }
    })

  return NextResponse.json<WeeklyUpdateDraftListResponse>({
    drafts,
    count: drafts.length,
  })
}
