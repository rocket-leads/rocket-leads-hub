import { createAdminClient } from "@/lib/supabase/server"

/**
 * Supabase Storage helper for Pedro-generated (and CM-uploaded) ad
 * images. Bucket `pedro-ad-images` is auto-created on first use so
 * there's no manual setup step - Roy can run a fresh deploy and
 * everything just works.
 *
 * Bucket policy:
 *   - PRIVATE (no public reads) - images may contain client branding
 *     or campaign data we shouldn't expose without auth.
 *   - Signed URLs only, ~1h expiry - long enough for a CM session,
 *     short enough that a leaked URL stops working before it matters.
 *
 * Path pattern: `<clientId>/<variantId>/<timestamp>.jpg`
 *   - clientId prefix lets us batch-delete on client offboard.
 *   - variantId prefix lets us batch-delete on regenerate (clean up
 *     the prior image before overwriting).
 *
 * Roy 2026-06-09.
 */

export const BUCKET = "pedro-ad-images"
const SIGNED_URL_EXPIRES_SEC = 60 * 60 // 1 hour

let bucketEnsured = false

/** Idempotent - checks once per process whether the bucket exists; if
 *  not, creates it. Subsequent calls are a no-op. We don't share the
 *  "bucket exists" state across processes because Vercel functions are
 *  cold-started independently anyway. */
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return
  const supabase = await createAdminClient()
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets()
  if (listErr) {
    console.error("[pedro-image-storage] listBuckets failed:", listErr.message)
    // Don't throw - the upload below will surface a clearer error if
    // the bucket truly doesn't exist.
    return
  }
  const exists = buckets?.some((b) => b.name === BUCKET) ?? false
  if (!exists) {
    const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 30 * 1024 * 1024, // 30 MB - Meta caps at ~30MB for image ads
    })
    if (createErr && !createErr.message.toLowerCase().includes("already exists")) {
      console.error("[pedro-image-storage] createBucket failed:", createErr.message)
      throw new Error(`Storage bucket ${BUCKET} kon niet worden aangemaakt: ${createErr.message}`)
    }
  }
  bucketEnsured = true
}

export type UploadResult = {
  storagePath: string
  width: number | null
  height: number | null
}

/**
 * Upload a JPEG or PNG blob to the bucket under the canonical slot
 * path. Per-slot cleanup so re-generating slot 0 never wipes slots 1+.
 *
 * Path layout: `<clientId>/<variantId>/p<position>/<timestamp>.<ext>`
 *
 * Width/height are best-effort: passed in by the caller when known
 * (Gemini returns the dimensions in the model response). For manual
 * uploads we don't sniff bytes - Meta will accept whatever and we
 * read the dimensions later if needed.
 */
export async function uploadVariantImage(args: {
  clientId: string
  variantId: string
  /** Slot index (0-9). Each slot has its own storage prefix so they
   *  can be regenerated/replaced independently. */
  position: number
  bytes: Buffer
  contentType: "image/jpeg" | "image/png"
  width?: number | null
  height?: number | null
}): Promise<UploadResult> {
  await ensureBucket()
  const supabase = await createAdminClient()

  const slotPrefix = `${args.clientId}/${args.variantId}/p${args.position}`

  // Delete prior images for this specific slot only.
  try {
    const { data: existing } = await supabase.storage.from(BUCKET).list(slotPrefix)
    if (existing && existing.length > 0) {
      const paths = existing.map((f) => `${slotPrefix}/${f.name}`)
      await supabase.storage.from(BUCKET).remove(paths)
    }
  } catch (e) {
    console.error(
      "[pedro-image-storage] prior-slot cleanup failed (continuing):",
      e instanceof Error ? e.message : e,
    )
  }

  const ext = args.contentType === "image/png" ? "png" : "jpg"
  const path = `${slotPrefix}/${Date.now()}.${ext}`

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, args.bytes, {
      contentType: args.contentType,
      upsert: false,
    })
  if (uploadErr) {
    throw new Error(`Image upload faalde: ${uploadErr.message}`)
  }

  return {
    storagePath: path,
    width: args.width ?? null,
    height: args.height ?? null,
  }
}

/** Generate a fresh signed URL for browser display. Always re-sign on
 *  read - never cache the URL in the variant row, the signature
 *  expires. */
export async function getVariantImageSignedUrl(
  storagePath: string,
): Promise<string | null> {
  if (!storagePath) return null
  const supabase = await createAdminClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRES_SEC)
  if (error || !data) {
    console.error(
      "[pedro-image-storage] createSignedUrl failed:",
      error?.message ?? "no data",
    )
    return null
  }
  return data.signedUrl
}

/** Pull the raw bytes back out - used by the Meta launch endpoint
 *  (Fase C) which forwards the image to Meta as an `ads/images`
 *  upload. */
export async function getVariantImageBytes(
  storagePath: string,
): Promise<Buffer | null> {
  if (!storagePath) return null
  const supabase = await createAdminClient()
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath)
  if (error || !data) {
    console.error(
      "[pedro-image-storage] download failed:",
      error?.message ?? "no data",
    )
    return null
  }
  const arrayBuffer = await data.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// ─── Manual ad-source screenshots ───────────────────────────────────────
// Roy 2026-06-10: CM uploadt soms een screenshot van een Meta ad (voor
// ads waar Meta geen thumbnail returnt). Pedro gebruikt die als reference
// image bij image generation ipv de ontbrekende winner thumbnail.
//
// Pad layout: `<clientId>/ad-source/<adId>.<ext>` - single file per
// (client, ad). Re-upload overschrijft de vorige.

function adSourcePrefix(clientId: string): string {
  return `${clientId}/ad-source`
}

/** Upload (or replace) the manual screenshot for one ad. */
export async function uploadAdSourceScreenshot(args: {
  clientId: string
  adId: string
  bytes: Buffer
  contentType: "image/jpeg" | "image/png"
}): Promise<{ storagePath: string }> {
  await ensureBucket()
  const supabase = await createAdminClient()
  const prefix = adSourcePrefix(args.clientId)
  // Wipe prior file(s) for this adId - any extension, any timestamp suffix.
  try {
    const { data: existing } = await supabase.storage.from(BUCKET).list(prefix)
    if (existing) {
      const matching = existing
        .filter((f) => f.name.startsWith(`${args.adId}.`))
        .map((f) => `${prefix}/${f.name}`)
      if (matching.length > 0) {
        await supabase.storage.from(BUCKET).remove(matching)
      }
    }
  } catch (e) {
    console.error(
      "[pedro-image-storage] ad-source prior cleanup failed (continuing):",
      e instanceof Error ? e.message : e,
    )
  }
  const ext = args.contentType === "image/png" ? "png" : "jpg"
  const path = `${prefix}/${args.adId}.${ext}`
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, args.bytes, {
      contentType: args.contentType,
      upsert: true,
    })
  if (uploadErr) {
    throw new Error(`Ad-source screenshot upload faalde: ${uploadErr.message}`)
  }
  return { storagePath: path }
}

/** Return all ad-source screenshots for a client as a Map<adId, signedUrl>.
 *  Used by AdPicker on mount so the CM ziet welke ads al een screenshot
 *  hebben. */
export async function listAdSourceScreenshots(
  clientId: string,
): Promise<Map<string, { storagePath: string; signedUrl: string | null }>> {
  if (!clientId) return new Map()
  const supabase = await createAdminClient()
  const prefix = adSourcePrefix(clientId)
  const out = new Map<string, { storagePath: string; signedUrl: string | null }>()
  try {
    const { data: files, error } = await supabase.storage.from(BUCKET).list(prefix)
    if (error) {
      // Folder doesn't exist yet = no screenshots. Don't treat as error.
      if (!/not found|does not exist/i.test(error.message)) {
        console.error("[pedro-image-storage] list ad-source failed:", error.message)
      }
      return out
    }
    if (!files || files.length === 0) return out
    // Sign all in parallel - cheap, ~50ms total.
    await Promise.all(
      files.map(async (f) => {
        // Filename = `<adId>.<ext>` - derive adId.
        const dot = f.name.lastIndexOf(".")
        const adId = dot > 0 ? f.name.slice(0, dot) : f.name
        const storagePath = `${prefix}/${f.name}`
        const { data: signed } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(storagePath, SIGNED_URL_EXPIRES_SEC)
        out.set(adId, {
          storagePath,
          signedUrl: signed?.signedUrl ?? null,
        })
      }),
    )
  } catch (e) {
    console.error(
      "[pedro-image-storage] list ad-source threw:",
      e instanceof Error ? e.message : e,
    )
  }
  return out
}

/** Delete the manual screenshot for one ad. Best-effort. */
export async function deleteAdSourceScreenshot(args: {
  clientId: string
  adId: string
}): Promise<void> {
  const supabase = await createAdminClient()
  const prefix = adSourcePrefix(args.clientId)
  try {
    const { data: existing } = await supabase.storage.from(BUCKET).list(prefix)
    if (!existing) return
    const matching = existing
      .filter((f) => f.name.startsWith(`${args.adId}.`))
      .map((f) => `${prefix}/${f.name}`)
    if (matching.length > 0) {
      await supabase.storage.from(BUCKET).remove(matching)
    }
  } catch (e) {
    console.error(
      "[pedro-image-storage] ad-source delete failed:",
      e instanceof Error ? e.message : e,
    )
  }
}
