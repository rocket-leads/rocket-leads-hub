"use server"

import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { encrypt } from "@/lib/encryption"
import { revalidatePath } from "next/cache"

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    throw new Error("Unauthorized")
  }
}

export async function saveApiToken(service: string, token: string) {
  await requireAdmin()
  const supabase = await createAdminClient()
  const { error } = await supabase.from("api_tokens").upsert(
    {
      service,
      token_encrypted: encrypt(token.trim()),
      is_valid: true,
      last_verified: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "service" }
  )
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

export async function saveBoardConfig(config: Record<string, unknown>) {
  await requireAdmin()
  const supabase = await createAdminClient()
  const { error } = await supabase.from("settings").upsert({
    key: "board_config",
    value: config,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

export async function updateUserRole(userId: string, role: "admin" | "member" | "guest") {
  await requireAdmin()
  const supabase = await createAdminClient()
  const { error } = await supabase.from("users").update({ role }).eq("id", userId)
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

export type ColumnMapping = {
  user_id: string
  monday_column_role: string
  monday_person_name: string
}

export async function saveColumnMappings(mappings: ColumnMapping[]) {
  await requireAdmin()
  const supabase = await createAdminClient()

  // Delete all existing mappings and re-insert
  const { error: deleteError } = await supabase
    .from("user_column_mappings")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000") // delete all rows

  if (deleteError) throw new Error(deleteError.message)

  if (mappings.length > 0) {
    const { error } = await supabase.from("user_column_mappings").insert(
      mappings.map((m) => ({
        user_id: m.user_id,
        monday_column_role: m.monday_column_role,
        monday_person_name: m.monday_person_name,
      }))
    )
    if (error) throw new Error(error.message)
  }

  revalidatePath("/settings")
  revalidatePath("/clients")
}
