import { createAdminClient } from "@/lib/supabase/server"

/**
 * Supabase Storage helper for user profile photos (avatars). Bucket
 * `user-avatars` is auto-created on first use (idempotent, mirrors
 * pedro-image-storage.ts) so a fresh deploy needs no manual setup.
 *
 * Bucket policy differs from Pedro's on purpose:
 *   - PUBLIC (public reads allowed). Avatars aren't sensitive, and a
 *     public URL is STABLE / non-expiring - so we can cache it in the
 *     NextAuth session and render it across the whole Hub (sidebar,
 *     inbox cards, comments, message threads) without re-signing on
 *     every read the way Pedro's private images require.
 *
 * Path pattern: `<userId>/<timestamp>.<ext>`
 *   - userId prefix → one folder per user, batch-deletable on removal.
 *   - timestamp filename → cache-busts the CDN when a user replaces
 *     their photo (the URL changes, so no stale image sticks around).
 *
 * Roy 2026-07-16.
 */

export const BUCKET = "user-avatars"

let bucketEnsured = false

/** Idempotent - checks once per process whether the bucket exists; if not,
 *  creates it as PUBLIC. Subsequent calls are a no-op. */
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return
  const supabase = await createAdminClient()
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets()
  if (listErr) {
    console.error("[user-avatar-storage] listBuckets failed:", listErr.message)
    // Don't throw - the upload below surfaces a clearer error if the bucket
    // truly doesn't exist.
    return
  }
  const exists = buckets?.some((b) => b.name === BUCKET) ?? false
  if (!exists) {
    const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024, // 5 MB - avatars are downscaled client-side to 256px
    })
    if (createErr && !createErr.message.toLowerCase().includes("already exists")) {
      console.error("[user-avatar-storage] createBucket failed:", createErr.message)
      throw new Error(
        `Storage bucket ${BUCKET} kon niet worden aangemaakt: ${createErr.message}`,
      )
    }
  }
  bucketEnsured = true
}

/** Remove every file under `<userId>/`. Best-effort; used both by the
 *  "remove photo" action and before an upload (one photo per user). */
async function clearUserFolder(userId: string): Promise<void> {
  const supabase = await createAdminClient()
  try {
    const { data: existing } = await supabase.storage.from(BUCKET).list(userId)
    if (existing && existing.length > 0) {
      const paths = existing.map((f) => `${userId}/${f.name}`)
      await supabase.storage.from(BUCKET).remove(paths)
    }
  } catch (e) {
    console.error(
      "[user-avatar-storage] folder cleanup failed (continuing):",
      e instanceof Error ? e.message : e,
    )
  }
}

/**
 * Upload (replacing any prior) the avatar for one user. Returns the stable
 * public URL to store in `users.avatar_url`.
 */
export async function uploadUserAvatar(args: {
  userId: string
  bytes: Buffer
  contentType: "image/jpeg" | "image/png" | "image/webp"
}): Promise<{ publicUrl: string }> {
  await ensureBucket()
  const supabase = await createAdminClient()

  // One photo per user - wipe the folder first so old files don't accumulate.
  await clearUserFolder(args.userId)

  const ext =
    args.contentType === "image/png"
      ? "png"
      : args.contentType === "image/webp"
        ? "webp"
        : "jpg"
  const path = `${args.userId}/${Date.now()}.${ext}`

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, args.bytes, { contentType: args.contentType, upsert: false })
  if (uploadErr) {
    throw new Error(`Avatar upload faalde: ${uploadErr.message}`)
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { publicUrl: data.publicUrl }
}

/** Delete every avatar file for a user (used by the "remove photo" flow). */
export async function deleteUserAvatar(userId: string): Promise<void> {
  await clearUserFolder(userId)
}
