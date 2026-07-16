"use server"

import { auth } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import {
  setUserPlatformToken,
  disconnectUserPlatform,
  type Platform,
} from "@/lib/inbox/user-platform-tokens"
import { setUserTrengoChannelIds } from "@/lib/inbox/user-prefs"
import { createAdminClient } from "@/lib/supabase/server"
import { uploadUserAvatar, deleteUserAvatar } from "@/lib/integrations/user-avatar-storage"

async function requireSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  return session.user.id
}

const AVATAR_MIME: Record<string, "image/jpeg" | "image/png" | "image/webp"> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
}
const MAX_AVATAR_BYTES = 5 * 1024 * 1024 // 5 MB (client downscales to 256px first)

/** Revalidate every surface that renders the current user's own photo. The
 *  "/" layout bust refreshes the sidebar (which reads session.user.image). */
function revalidateAvatarSurfaces() {
  revalidatePath("/", "layout")
  revalidatePath("/settings")
  revalidatePath("/account")
}

/**
 * Upload (or replace) the logged-in user's profile photo. Self-service - no
 * admin check; you can only ever change your own. The client downscales the
 * image to a 256px square JPEG before calling this, so the bytes are small.
 */
export async function updateMyAvatar(formData: FormData) {
  const userId = await requireSession()
  const file = formData.get("avatar")
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("No image provided")
  }
  const contentType = AVATAR_MIME[file.type.toLowerCase()]
  if (!contentType) {
    throw new Error("Unsupported image type - use PNG, JPEG or WebP")
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error("Image too large - keep it under 5 MB")
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const { publicUrl } = await uploadUserAvatar({ userId, bytes, contentType })

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("users")
    .update({ avatar_url: publicUrl })
    .eq("id", userId)
  if (error) throw new Error(error.message)

  revalidateAvatarSurfaces()
  return { avatarUrl: publicUrl }
}

/** Remove the logged-in user's profile photo (reverts to initials). */
export async function removeMyAvatar() {
  const userId = await requireSession()
  await deleteUserAvatar(userId)
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("users")
    .update({ avatar_url: null })
    .eq("id", userId)
  if (error) throw new Error(error.message)
  revalidateAvatarSurfaces()
}

/**
 * Connect (or replace) the logged-in user's personal token for a platform.
 * The token is AES-256-GCM encrypted via the same scheme as system api_tokens
 * before it ever lands in Supabase. Slack flows go through OAuth in C.4 - for
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

/**
 * Save the logged-in user's Trengo channel subscriptions. Empty array means
 * no extra subscriptions - visibility falls back to client-access only.
 */
export async function saveMyTrengoChannels(channelIds: number[]) {
  const userId = await requireSession()
  await setUserTrengoChannelIds(userId, channelIds)
  revalidatePath("/account")
  // The Client Inbox view depends on this; bust its server-rendered shell too.
  revalidatePath("/inbox")
}

