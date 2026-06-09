import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"
import { fetchTrengoChannels } from "@/lib/integrations/trengo"

/**
 * GET /api/inbox/trengo-identity
 *
 * Diagnostic for "why does every message appear as Roy in Trengo?" Roy
 * 2026-06-09: the Hub's send paths already use `getUserPlatformToken` for
 * the logged-in user / the client's AM, so attribution SHOULD land per
 * user. When it doesn't, the cause is operational — either the AM hasn't
 * connected their personal Trengo API token in /account, or they pasted
 * the workspace admin token (Roy's) by mistake. This endpoint surfaces
 * which one in a single response the UI can render as a status banner.
 *
 * Returns:
 *   - `connected`     boolean — user has a personal Trengo token saved
 *   - `trengoUser`    { id, full_name, email } | null — Trengo's `/me` for
 *                     that token. When this name is "Roy Vosters" for a
 *                     user who isn't Roy, that's the smoking gun: they
 *                     pasted the admin token, not their personal one.
 *   - `channelIds`    number[] — the user's Trengo channel subscriptions
 *                     from `users.trengo_channel_ids`
 *   - `channels`      array — resolved name + type per subscribed channel.
 *                     Missing email entries here = why /Client Inbox shows
 *                     only WhatsApp.
 *   - `hasEmail`      boolean — convenience flag for the banner copy
 *   - `hasWhatsapp`   boolean — convenience flag for the banner copy
 *   - `error`         string | null — token rejected (revoked / wrong env)
 *
 * Cached briefly so the ChatPane can poll without hammering Trengo.
 */

export type TrengoIdentity = {
  connected: boolean
  trengoUser: { id: number; full_name: string | null; email: string | null } | null
  channelIds: number[]
  channels: Array<{ id: number; name: string; type: "whatsapp" | "email" | "other" }>
  hasEmail: boolean
  hasWhatsapp: boolean
  error: string | null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const supabase = await createAdminClient()

  const [{ data: userRow }, userToken] = await Promise.all([
    supabase
      .from("users")
      .select("trengo_channel_ids")
      .eq("id", userId)
      .maybeSingle<{ trengo_channel_ids: number[] | null }>(),
    getUserPlatformToken(userId, "trengo"),
  ])

  const channelIds = Array.isArray(userRow?.trengo_channel_ids)
    ? userRow.trengo_channel_ids.filter(
        (n): n is number => typeof n === "number" && Number.isFinite(n),
      )
    : []

  // Resolve the subscribed channel ids → human-readable label + type. Even
  // when the personal token isn't connected we still want to show the
  // channel subscription picture, because that's the second half of the
  // visibility puzzle.
  const allChannels = await fetchTrengoChannels().catch(() => [])
  const channels = channelIds
    .map((id) => {
      const c = allChannels.find((cc) => cc.id === id)
      if (!c) return { id, name: `Channel ${id}`, type: "other" as const }
      const t = (c.type ?? "").toUpperCase()
      let type: "whatsapp" | "email" | "other" = "other"
      if (t === "WA_BUSINESS" || t === "WHATSAPP" || t.includes("WHATSAPP")) type = "whatsapp"
      else if (t === "EMAIL") type = "email"
      const title = typeof c.title === "string" ? c.title.trim() : ""
      const display = typeof c.display_name === "string" ? c.display_name.trim() : ""
      const name = title || display || `Channel ${id}`
      return { id, name, type }
    })
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type.localeCompare(b.type)))

  const hasEmail = channels.some((c) => c.type === "email")
  const hasWhatsapp = channels.some((c) => c.type === "whatsapp")

  // If no personal token, return the visibility picture but flag the
  // sending side as unconnected. The UI surfaces this as a "Connect
  // Trengo in /account" banner.
  if (!userToken) {
    return NextResponse.json<TrengoIdentity>({
      connected: false,
      trengoUser: null,
      channelIds,
      channels,
      hasEmail,
      hasWhatsapp,
      error: null,
    })
  }

  // Ask Trengo who this token actually represents. When this returns
  // "Roy Vosters" for an AM other than Roy → smoking gun that the
  // workspace admin token got pasted into their /account instead of
  // their personal one.
  let trengoUser: TrengoIdentity["trengoUser"] = null
  let error: string | null = null
  try {
    const res = await fetch("https://app.trengo.com/api/v2/users/me", {
      headers: { Authorization: `Bearer ${userToken}`, Accept: "application/json" },
      cache: "no-store",
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      error = `Trengo /me ${res.status}: ${text.slice(0, 200) || "rejected"}`
    } else {
      const json = (await res.json()) as
        | { id?: number; full_name?: string; email?: string; data?: { id?: number; full_name?: string; email?: string } }
      const inner = (json.data ?? json) as { id?: number; full_name?: string; email?: string }
      if (inner?.id) {
        trengoUser = {
          id: Number(inner.id),
          full_name: inner.full_name ?? null,
          email: inner.email ?? null,
        }
      } else {
        error = "Trengo /me returned no id"
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return NextResponse.json<TrengoIdentity>({
    connected: true,
    trengoUser,
    channelIds,
    channels,
    hasEmail,
    hasWhatsapp,
    error,
  })
}
