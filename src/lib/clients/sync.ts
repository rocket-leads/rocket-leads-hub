import { createAdminClient } from "@/lib/supabase/server"
import type { MondayClient } from "@/lib/integrations/monday"

export async function syncClientToSupabase(client: MondayClient): Promise<string> {
  const supabase = await createAdminClient()

  const syncFields = {
    monday_board_type: client.boardType,
    monday_client_board_id: client.clientBoardId || null,
    name: client.name,
    meta_ad_account_id: client.metaAdAccountId || null,
    stripe_customer_id: client.stripeCustomerId || null,
    trengo_contact_ids: client.trengoContactId ? [client.trengoContactId] : [],
    updated_at: new Date().toISOString(),
  }

  // Try update first — preserves columns like column_mapping_override and monday_active
  const { data: existing } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", client.mondayItemId)
    .single()

  if (existing) {
    const { error } = await supabase
      .from("clients")
      .update(syncFields)
      .eq("monday_item_id", client.mondayItemId)
    if (error) throw new Error(`Supabase sync failed: ${error.message}`)
    return existing.id
  }

  // Insert new client
  const { data, error } = await supabase
    .from("clients")
    .insert({ monday_item_id: client.mondayItemId, ...syncFields })
    .select("id")
    .single()

  if (error) throw new Error(`Supabase sync failed: ${error.message}`)
  return data!.id
}
