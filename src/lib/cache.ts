import { createAdminClient } from "@/lib/supabase/server"

const MAX_AGE_MS = 35 * 60 * 1000 // 35 minutes — slightly longer than the 30-min cron interval

export async function readCache<T>(key: string): Promise<T | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("cache_store")
    .select("data, updated_at")
    .eq("key", key)
    .single()

  if (!data) return null

  const age = Date.now() - new Date(data.updated_at).getTime()
  if (age > MAX_AGE_MS) return null

  return data.data as T
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  const supabase = await createAdminClient()
  await supabase
    .from("cache_store")
    .upsert({ key, data: value, updated_at: new Date().toISOString() }, { onConflict: "key" })
}
