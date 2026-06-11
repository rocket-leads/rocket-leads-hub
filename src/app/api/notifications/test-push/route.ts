import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { sendPushToUser } from "@/lib/notifications/push"
import { NextResponse } from "next/server"

/**
 * Diagnostic endpoint - sends a single test push to the authenticated user
 * AND returns enough state to debug the push pipe end-to-end.
 *
 * Returns:
 *   - userId:           who we're sending as (mismatch with subscribe UI = bug)
 *   - subscriptions:    rows currently in DB for this user (incl. endpoint host
 *                       so we can spot localhost vs production registrations)
 *   - vapidConfigured:  whether server-side VAPID env vars are present
 *   - delivered:        successful sends (target = subscriptions.length)
 *   - cleanedUp:        404/410 dead rows the send call removed
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = await createAdminClient()
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, user_agent, created_at")
    .eq("user_id", session.user.id)

  const result = await sendPushToUser(session.user.id, {
    title: "Test melding",
    body: "Als je dit ziet, werkt de push pipeline correct.",
    url: "/account",
    tag: "push-test",
  })

  return NextResponse.json({
    ok: true,
    userId: session.user.id,
    userEmail: session.user.email,
    vapidConfigured: !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY,
    subscriptionsBeforeSend: (subs ?? []).map((s) => ({
      id: s.id,
      // Just the host - we don't want to leak full endpoint URLs in the UI.
      endpointHost: (() => {
        try {
          return new URL(s.endpoint).host
        } catch {
          return "(invalid url)"
        }
      })(),
      userAgent: s.user_agent,
      createdAt: s.created_at,
    })),
    delivered: result.delivered,
    cleanedUp: result.cleanedUp,
  })
}
