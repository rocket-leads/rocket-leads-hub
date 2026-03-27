import { createAdminClient } from "@/lib/supabase/server"
import type { MondayClient } from "@/lib/monday"

export async function syncClientToSupabase(client: MondayClient): Promise<string> {
  const supabase = await createAdminClient()

  const { data, error } = await supabase
    .from("clients")
    .upsert(
      {
        monday_item_id: client.mondayItemId,
        monday_board_type: client.boardType,
        monday_client_board_id: client.clientBoardId || null,
        name: client.name,
        meta_ad_account_id: client.metaAdAccountId || null,
        stripe_customer_id: client.stripeCustomerId || null,
        trengo_contact_ids: client.trengoContactId ? [client.trengoContactId] : [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "monday_item_id" }
    )
    .select("id")
    .single()

  if (error) throw new Error(error.message)
  return data.id
}
