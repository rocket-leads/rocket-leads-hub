import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import { fetchAllItems } from "@/lib/integrations/monday"

export const maxDuration = 60

const TARGETS_BOARD_ID = "3762696870"
const MONDAY_API_URL = "https://api.monday.com/v2"

const NOT_UPDATED = ["Qualified", "Gepland"]
const TAKEN = ["No deal/FU", "No deal", "DEAL"]

function parseDate(dateStr: string): string | null {
  if (!dateStr) return null
  const match = dateStr.match(/(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

/**
 * Debug endpoint. Hit:
 *   /api/targets/debug-columns
 *   /api/targets/debug-columns?closer=Anel%20Selimovic&startDate=2026-04-01&endDate=2026-04-28
 */
export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const closerFilter = searchParams.get("closer") ?? ""
    const startDate = searchParams.get("startDate") ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    const endDate = searchParams.get("endDate") ?? new Date().toISOString().slice(0, 10)

    const supabase = await createAdminClient()
    const { data: tokenRow } = await supabase
      .from("api_tokens")
      .select("token_encrypted")
      .eq("service", "monday")
      .single()
    if (!tokenRow) return NextResponse.json({ error: "Monday token not configured" }, { status: 500 })
    const token = decrypt(tokenRow.token_encrypted)

    // 1) Column metadata
    const colsRes = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({
        query: `query GetCols($boardId: ID!) { boards(ids: [$boardId]) { columns { id title type } } }`,
        variables: { boardId: TARGETS_BOARD_ID },
      }),
    })
    const colsJson = await colsRes.json()
    const columns: Array<{ id: string; title: string; type: string }> = colsJson?.data?.boards?.[0]?.columns ?? []
    const interestingColumns = columns.filter((c) =>
      /wie|closer|verkocht|status|datum|afspraak|appointment|date|created/i.test(`${c.id} ${c.title}`)
    )

    // 2) Items via the proven helper
    const items = await fetchAllItems(TARGETS_BOARD_ID, token)
    const todayStr = new Date().toISOString().slice(0, 10)
    const getCol = (it: { column_values: Array<{ id: string; text: string }> }, id: string): string =>
      it.column_values.find((c) => c.id === id)?.text ?? ""

    // 3) Classify for the requested closer (or all)
    const classified = items
      .map((it) => {
        const closer = getCol(it, "wie_").trim()
        if (closerFilter && closer !== closerFilter) return null
        const datumAfspraakRaw = getCol(it, "datum_afspraak")
        const datumAfspraak = parseDate(datumAfspraakRaw)
        const status = getCol(it, "status")
        const inRange = !!datumAfspraak && datumAfspraak >= startDate && datumAfspraak <= endDate
        const isPast = !!datumAfspraak && datumAfspraak < todayStr

        let classification: string
        if (!closer) classification = "no-closer"
        else if (!datumAfspraak) classification = "no-appointment-date"
        else if (!inRange) classification = "out-of-range"
        else if (!isPast) classification = "future-or-today"
        else if (NOT_UPDATED.includes(status)) classification = "not-updated"
        else if (TAKEN.includes(status)) classification = "booked-and-taken"
        else classification = "booked-not-taken"

        return { id: it.id, name: it.name, closer, datumAfspraakRaw, datumAfspraak, status, inRange, isPast, classification }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    // 4) Aggregate per closer
    const counts: Record<string, { booked: number; taken: number; notUpdated: number; future: number; outOfRange: number; noDate: number }> = {}
    for (const c of classified) {
      if (!c.closer) continue
      if (!counts[c.closer]) counts[c.closer] = { booked: 0, taken: 0, notUpdated: 0, future: 0, outOfRange: 0, noDate: 0 }
      const k = counts[c.closer]
      if (c.classification === "booked-and-taken") { k.booked++; k.taken++ }
      else if (c.classification === "booked-not-taken") k.booked++
      else if (c.classification === "not-updated") k.notUpdated++
      else if (c.classification === "future-or-today") k.future++
      else if (c.classification === "out-of-range") k.outOfRange++
      else if (c.classification === "no-appointment-date") k.noDate++
    }

    const itemsForDump = closerFilter
      ? classified.filter((c) => c.classification !== "out-of-range" && c.classification !== "no-closer").slice(0, 80)
      : classified.slice(0, 30)

    return NextResponse.json({
      today: todayStr,
      period: { startDate, endDate },
      closerFilter,
      totalItemsScanned: items.length,
      interestingColumns,
      counts,
      items: itemsForDump,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", stack: error instanceof Error ? error.stack : undefined },
      { status: 500 },
    )
  }
}
