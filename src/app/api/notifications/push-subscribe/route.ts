import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

/**
 * POST  — register a push subscription for the current user.
 * DELETE — unregister by endpoint.
 *
 * The browser hands us the subscription object after the user grants
 * permission via PushManager.subscribe(). We unpack it into our table
 * (endpoint + p256dh + auth + userAgent) and key on (user_id, endpoint)
 * so the same browser doesn't accumulate duplicate rows on re-subscribe.
 */

type SubscribeBody = {
  subscription: {
    endpoint: string
    keys?: { p256dh?: string; auth?: string }
  }
  userAgent?: string | null
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: SubscribeBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const endpoint = body.subscription?.endpoint
  const p256dh = body.subscription?.keys?.p256dh
  const auth_ = body.subscription?.keys?.auth
  if (!endpoint || !p256dh || !auth_) {
    return NextResponse.json({ error: "Missing endpoint or keys" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: session.user.id,
      endpoint,
      p256dh,
      auth: auth_,
      user_agent: body.userAgent?.slice(0, 256) ?? null,
    },
    { onConflict: "user_id,endpoint" },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const endpoint = req.nextUrl.searchParams.get("endpoint")
  if (!endpoint) {
    return NextResponse.json({ error: "Missing endpoint" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", session.user.id)
    .eq("endpoint", endpoint)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
