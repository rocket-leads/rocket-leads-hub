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
      token_encrypted: encrypt(token),
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
