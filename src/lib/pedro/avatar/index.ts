import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import type { AvatarProvider, AvatarProviderId } from "@/lib/pedro/avatar/types"

/**
 * Resolve the active avatar provider for Pedro.
 *
 * Currently the agency runs one provider at a time (Heygen). When that
 * changes we extend this resolver — Pedro callers stay unchanged.
 *
 * Returns null when no provider is configured (no API token saved). UI
 * should surface a "configure provider in Settings → API Tokens" hint
 * instead of erroring.
 */
export async function getAvatarProvider(): Promise<AvatarProvider | null> {
  const supabase = await createAdminClient()

  // Try Heygen first (current default).
  const { data: heygen } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "heygen")
    .maybeSingle<{ token_encrypted: string }>()

  if (heygen?.token_encrypted) {
    try {
      const apiKey = decrypt(heygen.token_encrypted)
      // Lazy import — provider implementation lives behind this so the
      // bundler doesn't pull SDK code into request paths that don't
      // need avatars.
      const { HeygenProvider } = await import("@/lib/pedro/avatar/heygen")
      return new HeygenProvider(apiKey)
    } catch {
      return null
    }
  }

  return null
}

export type { AvatarProvider, AvatarProviderId } from "@/lib/pedro/avatar/types"
