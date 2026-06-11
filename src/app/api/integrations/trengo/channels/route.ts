import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import {
  deriveTrengoChannelDisplayName,
  fetchTrengoChannels,
} from "@/lib/integrations/trengo"

/**
 * GET /api/integrations/trengo/channels
 *
 * Returns the WhatsApp + Email channels in the Rocket Leads Trengo workspace
 * for the per-user subscription picker on /account. Other channel types
 * (voice, chat, social) are filtered out - the Hub Client Inbox today only
 * surfaces WhatsApp + email tickets, so listing the rest just adds noise.
 *
 * Display name is coalesced from several candidate fields because Trengo's
 * `/channels` endpoint frequently returns `name: null` for WhatsApp/Email
 * channels - the human-readable label lives in `title`, `phone`,
 * `email_address`, `display_name`, or `from`, depending on the channel type.
 *
 * Auth required so we don't leak channel metadata to anonymous callers; no
 * role gate beyond that since every Hub user picks their own subscriptions.
 */

const ALLOWED_TYPES = new Set([
  // Email family
  "EMAIL",
  "email",
  // WhatsApp family - Trengo has historically used several type strings
  "WA_BUSINESS",
  "wa_business",
  "WHATSAPP",
  "whatsapp",
  "whatsapp_business",
])

const TYPE_LABELS: Record<string, "Email" | "WhatsApp"> = {
  EMAIL: "Email",
  email: "Email",
  WA_BUSINESS: "WhatsApp",
  wa_business: "WhatsApp",
  WHATSAPP: "WhatsApp",
  whatsapp: "WhatsApp",
  whatsapp_business: "WhatsApp",
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // ?raw=1 → dump the raw Trengo response (admin only) so we can see exactly
  // which fields Trengo returns. Used to diagnose missing display names.
  const wantsRaw = req.nextUrl.searchParams.get("raw") === "1"
  if (wantsRaw && session.user.role === "admin") {
    const raw = await fetchTrengoChannels()
    return NextResponse.json({ raw })
  }

  try {
    const channels = await fetchTrengoChannels()

    const filtered = channels
      .filter((c) => ALLOWED_TYPES.has(c.type))
      // Drop disabled / archived channels - they show in /channels but the
      // user can't pick a useful subscription on them.
      .filter((c) => {
        const status = (c as { status?: string }).status
        return !status || status === "ACTIVE"
      })
      .map((c) => ({
        id: c.id,
        type: TYPE_LABELS[c.type] ?? c.type,
        name: deriveTrengoChannelDisplayName(c),
      }))
      .sort((a, b) => {
        // Group by type label first so Email/WhatsApp sit together, then
        // alphabetically within each group.
        if (a.type !== b.type) return a.type.localeCompare(b.type)
        return a.name.localeCompare(b.name)
      })

    return NextResponse.json({ channels: filtered })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load Trengo channels" },
      { status: 500 },
    )
  }
}
