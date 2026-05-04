import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Resolves the Hub user who should receive ingested inbox events for a given
 * client. Trengo and Monday webhooks call this so AI-classified tasks/updates
 * land on the responsible AM's "Assigned to me" filter instead of disappearing
 * into the system HQ account.
 *
 * Lookup chain:
 * 1. Find the client in the cached Monday boards (Monday item id key).
 * 2. Read its accountManager Monday display name.
 * 3. Resolve that name → Hub user_id via user_column_mappings.
 *
 * Returns null if any step fails so the caller can fall back to the system
 * HQ user (preserving the previous behaviour for unmapped clients).
 */
export async function resolveClientAssignee(
  clientMondayItemId: string,
): Promise<string | null> {
  if (!clientMondayItemId) return null

  let allClients: MondayClient[] = []
  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
  )
  if (cached) {
    allClients = [...cached.onboarding, ...cached.current]
  } else {
    try {
      const fresh = await fetchBothBoards()
      allClients = [...fresh.onboarding, ...fresh.current]
    } catch {
      return null
    }
  }

  const client = allClients.find((c) => c.mondayItemId === clientMondayItemId)
  const amName = client?.accountManager?.trim()
  if (!amName) return null

  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("user_column_mappings")
    .select("user_id")
    .eq("monday_column_role", "account_manager")
    .eq("monday_person_name", amName)
    .maybeSingle()

  return data?.user_id ?? null
}
