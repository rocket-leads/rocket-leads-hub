import { createAdminClient } from "@/lib/supabase/server"
import type { MondayClient } from "@/lib/monday"

type UserMapping = {
  monday_column_role: string
  monday_person_name: string
}

/**
 * Filter clients based on the user's column mappings.
 * - Admins see all clients.
 * - Users with no mappings see all clients (no restriction configured).
 * - Users with mappings only see clients where at least one mapped column matches.
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
