import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { searchTrengoContactsFull } from "@/lib/integrations/trengo"
import { readCache } from "@/lib/cache"
import type { MondayClient } from "@/lib/integrations/monday"

type Result = { id: string; name: string; phone: string | null; email: string | null }

const onlyDigits = (s: string | null) => (s ?? "").replace(/\D/g, "")

/**
 * GET /api/inbox/contact-search?q=<query>&kind=whatsapp|email
 *
 * Recipient search for the "New message" composer. Two sources, merged:
 *  1. Trengo contacts (name / phone / email substring search).
 *  2. Hub CLIENTS (cached Monday boards) matched by COMPANY name — so an
 *     un-named WhatsApp number (whose Trengo "name" is just the number) can be
 *     found by the client it belongs to. Company matches are listed first and
 *     dedupe the Trengo result with the same phone/email. Roy 2026-07-30.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const q = req.nextUrl.searchParams.get("q") ?? ""
  const kind = req.nextUrl.searchParams.get("kind")
  const isWa = kind === "whatsapp"
  const isEmail = kind === "email"

  try {
    const trengo = await searchTrengoContactsFull(q, 25)
    let contacts: Result[] = trengo
      .map((c) => ({ id: `t${c.id}`, name: c.name, phone: c.phone, email: c.email }))
      .filter((c) => (isWa ? !!c.phone : isEmail ? !!c.email : true))

    // Company-name matches from the cached Monday client list.
    const ql = q.trim().toLowerCase()
    if (ql.length >= 2) {
      const boards = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
        "monday_boards",
      )
      const all = [...(boards?.onboarding ?? []), ...(boards?.current ?? [])]
      const clientMatches: Result[] = all
        .filter((cl) => {
          const val = (isWa ? cl.phone : cl.email)?.trim()
          if (!val) return false
          const hay = `${cl.companyName} ${cl.name} ${cl.firstName}`.toLowerCase()
          return hay.includes(ql)
        })
        .slice(0, 10)
        .map((cl) => ({
          id: `c${cl.mondayItemId}`,
          name: cl.companyName || cl.name,
          phone: cl.phone || null,
          email: cl.email || null,
        }))

      if (clientMatches.length > 0) {
        const seen = new Set(
          clientMatches.map((m) => (isWa ? onlyDigits(m.phone) : (m.email ?? "").toLowerCase())),
        )
        contacts = [
          ...clientMatches,
          ...contacts.filter(
            (c) => !seen.has(isWa ? onlyDigits(c.phone) : (c.email ?? "").toLowerCase()),
          ),
        ]
      }
    }

    return NextResponse.json({ contacts })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Contact search failed" },
      { status: 500 },
    )
  }
}
