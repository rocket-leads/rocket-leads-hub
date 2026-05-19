import { createAdminClient } from "@/lib/supabase/server"
import type { MondayClient } from "@/lib/integrations/monday"

type UserMapping = {
  monday_column_role: string
  monday_person_name: string
}

/**
 * Pre-loaded user mappings (queried once, reused across multiple board filters).
 * Pass `null` from the caller to bypass filtering entirely (admin / finance / no
 * mappings); pass an array to filter against those mappings without re-querying.
 */
export type UserMappingsContext = UserMapping[] | null

/**
 * Single-query helper for callers that filter multiple boards for the same user
 * (e.g. /clients page filters onboarding + current). Returns null when the user
 * should see everything (admin, finance, or no mappings configured).
 */
export async function loadUserMappingsContext(
  userId: string,
  role: string,
): Promise<UserMappingsContext> {
  if (role === "admin") return null

  const supabase = await createAdminClient()
  const { data: mappings } = await supabase
    .from("user_column_mappings")
    .select("monday_column_role, monday_person_name")
    .eq("user_id", userId)

  if (!mappings || mappings.length === 0) return null

  // Finance is org-level — they need to see everyone for invoicing /
  // billing context. Treat the same as admin for visibility.
  if ((mappings as UserMapping[]).some((m) => m.monday_column_role === "finance")) {
    return null
  }

  return mappings as UserMapping[]
}

/** Pure filter once mappings are loaded — zero round-trips. */
export function filterClientsByContext(
  clients: MondayClient[],
  context: UserMappingsContext,
): MondayClient[] {
  if (context === null) return clients

  const mappingsByRole = new Map<string, string>()
  for (const m of context) mappingsByRole.set(m.monday_column_role, m.monday_person_name)

  return clients.filter((client) => {
    for (const [role, personName] of mappingsByRole) {
      if (role === "account_manager" && client.accountManager === personName) return true
      if (role === "campaign_manager" && client.campaignManager === personName) return true
      if (role === "appointment_setter" && client.appointmentSetter === personName) return true
    }
    return false
  })
}

/**
 * Filter clients based on the user's column mappings.
 * - Admins see all clients.
 * - Finance users see all clients (org-wide invoicing/billing scope — can't
 *   do their job with per-client mapping).
 * - Users with no client-level mappings see all clients (no restriction).
 * - Users with AM/CM/Setter mappings only see clients where at least one
 *   mapped column matches.
 */
export async function filterClientsByUser(
  clients: MondayClient[],
  userId: string,
  role: string
): Promise<MondayClient[]> {
  const context = await loadUserMappingsContext(userId, role)
  return filterClientsByContext(clients, context)
}
