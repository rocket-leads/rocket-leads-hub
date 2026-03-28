import { createAdminClient } from "@/lib/supabase/server"
import type { MondayClient } from "@/lib/monday"

export async function syncClientToSupabase(client: MondayClient): Promise<string> {
  const supabase = await createAdminClient()

  // Try with monday_client_board_id first; if column doesn't exist, retry without it
  const payload: Record<string, unknown> = {
    monday_item_id: client.mondayItemId,
    monday_board_type: client.boardType,
    monday_client_board_id: client.clientBoardId || null,
    name: client.name,
    meta_ad_account_id: client.metaAdAccountId || null,
    stripe_customer_id: client.stripeCustomerId || null,
    trengo_contact_ids: client.trengoContactId ? [client.trengoContactId] : [],
    updated_at: new Date().toISOString(),
  }

  let { data, error } = await supabase
    .from("clients")
    .upsert(payload, { onConflict: "monday_item_id" })
    .select("id")
    .single()

  // If the column doesn't exist in the DB, retry without it
  if (error?.message?.includes("monday_client_board_id")) {
    delete payload.monday_client_board_id
    const retry = await supabase
      .from("clients")
      .upsert(payload, { onConflict: "monday_item_id" })
      .select("id")
      .single()
    data = retry.data
    error = retry.error
  }

  if (error) throw new Error(error.message)
  return data!.id
}
