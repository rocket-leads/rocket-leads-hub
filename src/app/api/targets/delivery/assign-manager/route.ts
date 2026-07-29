import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateClientField } from "@/lib/clients/edit"
import { clientItemCacheKey } from "@/lib/integrations/monday"
import { createAdminClient } from "@/lib/supabase/server"
import { deleteCache } from "@/lib/cache"

/**
 * Sets the Account Manager (and optionally Campaign Manager) on a Monday client
 * item straight from the Delivery tab's "Unassigned" fixer - so revenue with a
 * linked-but-unassigned client can be attributed without opening Monday.
 *
 * Writes through `updateClientField` (same path as the client slide-over): it
 * writes the Monday person column, patches the `monday_boards` cache with the
 * known value to dodge Monday's read-after-write race, and mirrors Supabase.
 * On top of that we wipe the delivery cache so the AM rollup recomputes on the
 * next read. Person names accompany the IDs so the cache patch renders the
 * right label immediately instead of flashing back to "Unassigned".
 *
 * body: {
 *   mondayItemId,
 *   accountManager?:  { ids: number[]; names: string[] },
 *   campaignManager?: { ids: number[]; names: string[] },
 * }
 * At least one of accountManager / campaignManager must be present.
 */

type PersonPayload = { ids?: unknown; names?: unknown }

function normalizePerson(p: PersonPayload | undefined): { ids: number[]; names: string[] } | null {
  if (!p) return null
  const ids = Array.isArray(p.ids) ? p.ids.filter((n): n is number => typeof n === "number") : []
  const names = Array.isArray(p.names) ? p.names.filter((n): n is string => typeof n === "string") : []
  return { ids, names }
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { mondayItemId?: string; accountManager?: PersonPayload; campaignManager?: PersonPayload }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { mondayItemId } = body
  if (!mondayItemId || typeof mondayItemId !== "string") {
    return NextResponse.json({ error: "mondayItemId required" }, { status: 400 })
  }

  const am = normalizePerson(body.accountManager)
  const cm = normalizePerson(body.campaignManager)
  if (!am && !cm) {
    return NextResponse.json({ error: "accountManager or campaignManager required" }, { status: 400 })
  }

  try {
    // Sequential, not parallel: both edits mutate the same cached client
    // snapshot via patchCacheWithKnownValue - running them concurrently would
    // race the read-modify-write on `monday_boards` and lose one field.
    if (am) {
      await updateClientField(mondayItemId, {
        fieldKey: "account_manager",
        personIds: am.ids,
        personNames: am.names,
      })
    }
    if (cm) {
      await updateClientField(mondayItemId, {
        fieldKey: "campaign_manager",
        personIds: cm.ids,
        personNames: cm.names,
      })
    }
  } catch (error) {
    console.error("[assign-manager] Monday update failed:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update Monday" },
      { status: 500 },
    )
  }

  // Burst the delivery cache (MTD + historical) + the per-item slide-over cache
  // so both the Delivery rollup and the client panel reflect the new AM/CM now.
  try {
    const supabase = await createAdminClient()
    await supabase.from("cache_store").delete().like("key", "targets_delivery%")
  } catch (error) {
    console.warn("[assign-manager] cache wipe failed:", error)
  }
  void deleteCache(clientItemCacheKey(mondayItemId))

  return NextResponse.json({ ok: true })
}
