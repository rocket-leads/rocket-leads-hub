import { createAdminClient } from "@/lib/supabase/server"

export type ClientAccess = {
  canViewCampaigns: boolean
  canViewBilling: boolean
  canViewCommunication: boolean
}

const FULL_ACCESS: ClientAccess = {
  canViewCampaigns: true,
  canViewBilling: true,
  canViewCommunication: true,
}

const NO_ACCESS: ClientAccess = {
  canViewCampaigns: false,
  canViewBilling: false,
  canViewCommunication: false,
}

/**
 * Get per-tab access for a user on a specific client.
 * - Admins always get full access.
 * - Finance users always get full access (org-level role; need every tab to
 *   contextualise an invoice).
 * - If a client_access row exists, use its permissions.
 * - Members without a row get full access; guests without a row get no access.
 * - Campaign managers (without finance / AM overlap) lose Billing AND
 *   Communication visibility (Roy 2026-06-11) - billing context is for
 *   AM/Finance/Admin only, and client conversations are an AM workflow.
 *   CMs only see chat rows where they are explicitly mentioned/assigned
 *   (handled in the chat-thread fetcher via the cm_only audience role).
 */
export async function getClientAccess(
  userId: string,
  role: string,
  mondayItemId: string
): Promise<ClientAccess> {
  if (role === "admin") return FULL_ACCESS

  const supabase = await createAdminClient()

  // Pull the user's Monday role mappings once. A user can hold multiple
  // mappings (e.g. both AM + CM during a coverage period) so we check the
  // full set to decide what to allow.
  const { data: roleRows } = await supabase
    .from("user_column_mappings")
    .select("monday_column_role")
    .eq("user_id", userId)
  const roleSet = new Set<string>((roleRows ?? []).map((r) => r.monday_column_role as string))

  if (roleSet.has("finance")) return FULL_ACCESS

  const isPureCm = roleSet.has("campaign_manager") && !roleSet.has("account_manager")

  // Look up the Supabase client ID from the Monday item ID
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", mondayItemId)
    .single()

  let access: ClientAccess
  if (!client) {
    // Client not yet synced - members get full access, guests get none
    access = role === "guest" ? NO_ACCESS : { ...FULL_ACCESS }
  } else {
    const { data: row } = await supabase
      .from("client_access")
      .select("can_view_campaigns, can_view_billing, can_view_communication")
      .eq("user_id", userId)
      .eq("client_id", client.id)
      .single()

    if (!row) {
      access = role === "guest" ? NO_ACCESS : { ...FULL_ACCESS }
    } else {
      access = {
        canViewCampaigns: row.can_view_campaigns,
        canViewBilling: row.can_view_billing,
        canViewCommunication: row.can_view_communication,
      }
    }
  }

  if (isPureCm) {
    access.canViewBilling = false
    access.canViewCommunication = false
  }

  return access
}

/**
 * Check a single tab permission. Used by API routes.
 */
export async function checkTabAccess(
  userId: string,
  role: string,
  mondayItemId: string,
  tab: "campaigns" | "billing" | "communication"
): Promise<boolean> {
  const access = await getClientAccess(userId, role, mondayItemId)
  switch (tab) {
    case "campaigns":
      return access.canViewCampaigns
    case "billing":
      return access.canViewBilling
    case "communication":
      return access.canViewCommunication
  }
}
