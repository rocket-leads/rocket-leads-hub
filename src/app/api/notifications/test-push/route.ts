import { auth } from "@/lib/auth"
import { sendPushToUser } from "@/lib/notifications/push"
import { NextResponse } from "next/server"

/**
 * Diagnostic endpoint — sends a single test push to the authenticated user.
 *
 * Use case: Roy enabled notifications and didn't see one when a real task
 * fired. Hitting this endpoint proves whether the push pipe works end-to-end
 * (VAPID keys, service worker, subscription registered) independent of
 * whether any other trigger is firing.
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await sendPushToUser(session.user.id, {
    title: "Test melding",
    body: "Als je dit ziet, werkt de push pipeline correct.",
    url: "/account",
    tag: "push-test",
  })

  return NextResponse.json({
    ok: true,
    delivered: result.delivered,
    cleanedUp: result.cleanedUp,
    userId: session.user.id,
  })
}
