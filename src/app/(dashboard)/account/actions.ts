"use server"

import { auth } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import {
  setUserPlatformToken,
  disconnectUserPlatform,
  type Platform,
} from "@/lib/inbox/user-platform-tokens"

async function requireSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  return session.user.id
}

/**
 * Connect (or replace) the logged-in user's personal token for a platform.
 * The token is AES-256-GCM encrypted via the same scheme as system api_tokens
 * before it ever lands in Supabase. Slack flows go through OAuth in C.4 — for
 * Trengo + Monday the user pastes a personal access token from the platform
 * settings.
 */
export async function connectMyPlatform(platform: Platform, token: string) {
  const userId = await requireSession()
  await setUserPlatformToken(userId, platform, token)
  revalidatePath("/account")
}

/** Drop the logged-in user's stored token for a platform. */
export async function disconnectMyPlatform(platform: Platform) {
  const userId = await requireSession()
  await disconnectUserPlatform(userId, platform)
  revalidatePath("/account")
}
