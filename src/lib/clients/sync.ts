import { createAdminClient } from "@/lib/supabase/server"
import type { MondayClient } from "@/lib/integrations/monday"

export async function syncClientToSupabase(client: MondayClient): Promise<string> {
  const supabase = await createAdminClient()

  const payload: Record<string, unknown> = {
    monday_item_id: client.mondayItemId,
    monday_board_type: client.boardType,
    monday_client_board_id: client.clientBoardId || null,
    name: client.name,
    meta_ad_account_id: client.metaAdAccountId || null,
    stripe_customer_id: client.stripeCustomerId || null,
    trengo_contact_ids: client.trengoContactId ? [client.trengoContactId] : [],
    google_drive_folder_id: client.googleDriveFolderId || null,
    updated_at: new Date().toISOString(),
  }

  let { data, error } = await supabase
    .from("clients")
    .upsert(payload, { onConflict: "monday_item_id" })
    .select("id")
    .single()

  // If the column doesn't exist in the DB, retry without it
  if (error && (error.code === "PGRST204" || error.message?.includes("monday_client_board_id"))) {
    console.warn("[sync-client] monday_client_board_id column missing — retrying without it. Run migration to fix permanently.")
    delete payload.monday_client_board_id
    const retry = await supabase
      .from("clients")
      .upsert(payload, { onConflict: "monday_item_id" })
      .select("id")
      .single()
    data = retry.data
    error = retry.error
  }

  if (error) throw new Error(`Supabase sync failed: ${error.message}`)
  return data!.id
}
