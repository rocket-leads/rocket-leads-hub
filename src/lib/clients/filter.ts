import { createAdminClient } from "@/lib/supabase/server"
import type { MondayClient } from "@/lib/integrations/monday"

type UserMapping = {
  monday_column_role: string
  monday_person_name: string
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
  if (role === "admin") return clients

  const supabase = await createAdminClient()
  const { data: mappings } = await supabase
    .from("user_column_mappings")
    .select("monday_column_role, monday_person_name")
    .eq("user_id", userId)

  if (!mappings || mappings.length === 0) return clients

  // Finance is org-level — they need to see everyone for invoicing /
  // billing context. Treat the same as admin for visibility.
  if ((mappings as UserMapping[]).some((m) => m.monday_column_role === "finance")) {
    return clients
  }

  const mappingsByRole = new Map<string, string>()
  for (const m of mappings as UserMapping[]) {
    mappingsByRole.set(m.monday_column_role, m.monday_person_name)
  }

  return clients.filter((client) => {
    for (const [role, personName] of mappingsByRole) {
      if (role === "account_manager" && client.accountManager === personName) return true
      if (role === "campaign_manager" && client.campaignManager === personName) return true
      if (role === "appointment_setter" && client.appointmentSetter === personName) return true
    }
    return false
  })
}
