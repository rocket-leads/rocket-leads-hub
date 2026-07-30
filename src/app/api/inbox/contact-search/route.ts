import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { searchTrengoContactsFull } from "@/lib/integrations/trengo"
import { readCache } from "@/lib/cache"
import type { MondayClient } from "@/lib/integrations/monday"

type Source = "trengo" | "monday"
type Result = {
  id: string
  name: string
  phone: string | null
  email: string | null
  source: Source
}

const onlyDigits = (s: string | null) => (s ?? "").replace(/\D/g, "")

/**
 * GET /api/inbox/contact-search?q=<query>&kind=whatsapp|email
 *
 * Recipient search for the "New message" composer. Two sources, merged, deduped
 * by phone/email, and RANKED by how well the query matches the DISPLAYED name
 * (exact > starts-with > contains > matched-on-a-hidden-field). So a Trengo
 * contact literally named "Roy" beats a client company whose contact person
 * merely happens to be Roy. Each result carries its `source` (trengo / monday)
 * so the UI can show where it came from. Roy 2026-07-30.
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
  const ql = q.trim().toLowerCase()

  try {
    const trengo = await searchTrengoContactsFull(q, 25)
    const trengoResults: Result[] = trengo
      .map((c) => ({
        id: `t${c.id}`,
        name: c.name,
        phone: c.phone,
        email: c.email,
        source: "trengo" as const,
      }))
      .filter((c) => (isWa ? !!c.phone : isEmail ? !!c.email : true))

    // Hub client (Monday) matches — lets an un-named WhatsApp number surface
    // under the client it belongs to (by company OR contact-person name).
    let clientResults: Result[] = []
    if (ql.length >= 2) {
      const boards = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
        "monday_boards",
      )
      const all = [...(boards?.onboarding ?? []), ...(boards?.current ?? [])]
      clientResults = all
        .filter((cl) => {
          const val = (isWa ? cl.phone : cl.email)?.trim()
          if (!val) return false
          const hay = `${cl.companyName} ${cl.name} ${cl.firstName}`.toLowerCase()
          return hay.includes(ql)
        })
        .slice(0, 20)
        .map((cl) => ({
          id: `c${cl.mondayItemId}`,
          name: cl.companyName || cl.name,
          phone: cl.phone || null,
          email: cl.email || null,
          source: "monday" as const,
        }))
    }

    // Relevance of the query against the displayed name. A result that only
    // matched on a hidden field (e.g. the client's contact-person "Roy" while
    // the shown name is the company) scores lowest.
    const score = (name: string): number => {
      const n = name.toLowerCase()
      if (!ql) return 0
      if (n === ql) return 4
      if (n.startsWith(ql)) return 3
      if (n.includes(ql)) return 2
      return 1
    }

    // Merge + dedupe by phone (WA) / email, keeping the better-scored entry.
    const byKey = new Map<string, { c: Result; s: number }>()
    for (const c of [...clientResults, ...trengoResults]) {
      const k = isWa ? onlyDigits(c.phone) : (c.email ?? "").toLowerCase()
      if (!k) continue
      const s = score(c.name)
      const ex = byKey.get(k)
      if (!ex || s > ex.s) byKey.set(k, { c, s })
    }
    const contacts = [...byKey.values()].sort((a, b) => b.s - a.s).map((x) => x.c)

    return NextResponse.json({ contacts })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Contact search failed" },
      { status: 500 },
    )
  }
}
