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
 * - If a client_access row exists, use its permissions.
 * - Members without a row get full access; guests without a row get no access.
 */
export async function getClientAccess(
  userId: string,
  role: string,
  mondayItemId: string
): Promise<ClientAccess> {
  if (role === "admin") return FULL_ACCESS

  const supabase = await createAdminClient()

  // Look up the Supabase client ID from the Monday item ID
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", mondayItemId)
    .single()

  if (!client) {
    // Client not yet synced — members get full access, guests get none
    return role === "guest" ? NO_ACCESS : FULL_ACCESS
  }

  const { data: access } = await supabase
    .from("client_access")
    .select("can_view_campaigns, can_view_billing, can_view_communication")
    .eq("user_id", userId)
    .eq("client_id", client.id)
    .single()

  if (!access) {
    return role === "guest" ? NO_ACCESS : FULL_ACCESS
  }

  return {
    canViewCampaigns: access.can_view_campaigns,
    canViewBilling: access.can_view_billing,
    canViewCommunication: access.can_view_communication,
  }
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
