import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  deriveTrengoChannelDisplayName,
  fetchTrengoChannels,
  isEmailChannelType,
  isWhatsAppChannelType,
} from "@/lib/integrations/trengo"
import { safeFetch } from "@/lib/safe-fetch"

/**
 * Per-user primary-channel dropdowns in Settings → Users need an
 * up-to-date list of Trengo email + WhatsApp channels. Used to live in
 * `settings/page.tsx` SSR, but Trengo's `/channels` endpoint is slow
 * (1–2s cold) and blocked the whole Settings page from rendering. Now
 * UsersTab fetches it on mount via React Query, so the rest of Settings
 * paints instantly.
 *
 * Returns the same shape `UsersTab` used to receive - channels already
 * tagged with `isEmail` / `isWa` so the dropdowns don't have to
 * re-classify on every render.
 */
export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const channels = await safeFetch(
    "api:trengo_channels",
    () => fetchTrengoChannels(),
    [] as Awaited<ReturnType<typeof fetchTrengoChannels>>,
  )

  const options = channels
    .filter((c) => isEmailChannelType(c.type) || isWhatsAppChannelType(c.type))
    .map((c) => ({
      id: c.id,
      // Trengo returns `name: "Email"` for every email channel - useless
      // when picking between multiple. deriveTrengoChannelDisplayName
      // falls through to display_name / email_address so dropdowns
      // actually show "support@…" instead of "Email".
      name: deriveTrengoChannelDisplayName(c),
      type: c.type,
      isEmail: isEmailChannelType(c.type),
      isWa: isWhatsAppChannelType(c.type),
    }))

  return NextResponse.json({ channels: options })
}
