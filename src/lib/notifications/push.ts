import webpush from "web-push"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Phase F - browser push notifications.
 *
 * This module is the only place that knows how to deliver a push to a user.
 * Callers (inbox automation, comment hooks, future @mentions) just hand off
 * a payload + user_id and we resolve the user's active subscriptions and
 * fan out. Failed endpoints (browser uninstalled, subscription expired) get
 * cleaned up automatically so we don't keep retrying dead clients.
 *
 * Setup (one-time, see README pointer in the Account page):
 *   1. Generate VAPID keys: `npx web-push generate-vapid-keys`
 *   2. Set env vars in Vercel:
 *        VAPID_PUBLIC_KEY=B...
 *        VAPID_PRIVATE_KEY=...
 *        VAPID_CONTACT_EMAIL=mailto:roy@rocketleads.com
 *   3. Same VAPID_PUBLIC_KEY also exposed as NEXT_PUBLIC_VAPID_PUBLIC_KEY
 *      so the browser-side subscribe flow can pass it to PushManager.
 */

let vapidConfigured = false
function configureVapid(): boolean {
  if (vapidConfigured) return true
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const contact = process.env.VAPID_CONTACT_EMAIL ?? "mailto:notifications@rocketleads.com"
  if (!publicKey || !privateKey) {
    console.warn("VAPID keys not configured - push notifications disabled")
    return false
  }
  webpush.setVapidDetails(contact, publicKey, privateKey)
  vapidConfigured = true
  return true
}

export type PushPayload = {
  /** Headline shown bold in the notification banner. */
  title: string
  /** Body text under the title. Keep ≤120 chars for mobile. */
  body: string
  /** Where the user lands when they click the notification. Relative paths
   *  are resolved against the Hub origin in the service worker. */
  url?: string
  /** Optional grouping tag - same tag replaces an older notification rather
   *  than stacking. Use this for "your inbox has X new tasks" updates that
   *  shouldn't pile up if the user is offline a while. */
  tag?: string
}

/**
 * Fan out a payload to every active push subscription for `userId`. Returns
 * the count delivered. Cleans up subscriptions the push service rejected as
 * gone (404/410) so dead clients stop racking up failed sends.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ delivered: number; cleanedUp: number }> {
  if (!configureVapid()) return { delivered: 0, cleanedUp: 0 }

  const supabase = await createAdminClient()
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId)

  if (!subs || subs.length === 0) return { delivered: 0, cleanedUp: 0 }

  const json = JSON.stringify(payload)
  let delivered = 0
  const deadIds: string[] = []

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          json,
        )
        delivered++
      } catch (e: unknown) {
        const status = (e as { statusCode?: number }).statusCode ?? 0
        // 404 = endpoint never existed; 410 = subscription was unsubscribed.
        // Either way the row is dead; drop it.
        if (status === 404 || status === 410) {
          deadIds.push(s.id)
        } else {
          console.error("Push send failed:", e)
        }
      }
    }),
  )

  if (deadIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", deadIds)
  }

  // Bump last_used_at on whichever subs delivered - cheap signal for "this
  // device is still alive" if we ever want to prune stale ones.
  if (delivered > 0) {
    const liveIds = subs.filter((s) => !deadIds.includes(s.id)).map((s) => s.id)
    if (liveIds.length > 0) {
      await supabase
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .in("id", liveIds)
    }
  }

  return { delivered, cleanedUp: deadIds.length }
}
