import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { searchTrengoContactsFull } from "@/lib/integrations/trengo"

/**
 * GET /api/inbox/contact-search?q=<query>&kind=whatsapp|email
 *
 * Trengo contact search for the "New message" composer — returns the raw
 * name + phone + email so the composer can wire a WhatsApp (phone) or email
 * (address) send from a picked contact. `kind` filters to contacts that have
 * the field the medium needs. Empty query returns recent contacts.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const q = req.nextUrl.searchParams.get("q") ?? ""
  const kind = req.nextUrl.searchParams.get("kind")
  try {
    const all = await searchTrengoContactsFull(q, 25)
    const contacts =
      kind === "whatsapp"
        ? all.filter((c) => !!c.phone)
        : kind === "email"
          ? all.filter((c) => !!c.email)
          : all
    return NextResponse.json({ contacts })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Contact search failed" },
      { status: 500 },
    )
  }
}
