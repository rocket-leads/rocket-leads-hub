import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getToken } from "@/lib/integrations/monday"

const MONDAY_API = "https://api.monday.com/v2"
const BOARD_ID = "1316567475"

async function mondayGQL(token: string, query: string) {
  const res = await fetch(MONDAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query }),
  })
  const data = await res.json()
  if (data.errors) {
    console.error("Pedro Monday GraphQL errors:", JSON.stringify(data.errors))
    throw new Error(data.errors[0]?.message || "Monday API error")
  }
  return data.data
}

function parseKickoffDirect(text: string) {
  function extract(label: string): string {
    const regex = new RegExp(
      `${label}\\s*:\\s*([\\s\\S]*?)(?=\\n(?:Company name|Information|Deal|Customer value|Product\\/service|Target audience|Location|Marketing hooks|USP'?s|Follow-up|Leads form|Future questions|Zapier data|Standard automations|Content|Website\\/Socials|Comments|Google Drive|Advertising budget|Goal|Offer|Timeframe|Monthly fee|Guarantee)\\s*:|$)`,
      "i"
    )
    const m = text.match(regex)
    if (!m) return ""
    return m[1]
      .split("\n")
      .map((l) => l.replace(/^[-•]\s*/, "").trim())
      .filter(Boolean)
      .join("\n")
      .trim()
  }

  const driveMatch = text.match(/https?:\/\/drive\.google\.com[^\s)}\]"']*/i)

  return {
    bedrijf: extract("Company name"),
    productService: extract("Product/service"),
    targetAudience: extract("Target audience"),
    location: extract("Location"),
    marketingHooks: extract("Marketing hooks"),
    usps: extract("USP's") || extract("USPs"),
    advertisingBudget: extract("Advertising budget"),
    goal: extract("Goal"),
    customerValue: extract("Customer value"),
    deal: extract("Offer"),
    driveLink: driveMatch?.[0] || "",
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let token: string
  try {
    token = await getToken()
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Monday token error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const { action, searchTerm, itemId } = await req.json()

  try {
    if (action === "search") {
      if (!searchTerm?.trim()) {
        return NextResponse.json({ error: "Geen zoekterm opgegeven" }, { status: 400 })
      }

      const safe = searchTerm.replace(/"/g, '\\"').trim()
      const query = `query {
        boards(ids: [${BOARD_ID}]) {
          items_page(limit: 20, query_params: {
            rules: [{ column_id: "name", compare_value: ["${safe}"], operator: contains_text }]
          }) {
            items { id name }
          }
        }
      }`

      const data = await mondayGQL(token, query)
      const items = data?.boards?.[0]?.items_page?.items || []

      if (items.length === 0) {
        return NextResponse.json(
          { items: [], error: "Klant niet gevonden in monday" },
          { status: 200 }
        )
      }

      return NextResponse.json({ items })
    }

    if (action === "updates") {
      if (!itemId) {
        return NextResponse.json({ error: "Geen itemId opgegeven" }, { status: 400 })
      }

      const query = `query {
        items(ids: [${itemId}]) {
          id
          name
          updates(limit: 30) { id text_body created_at }
        }
      }`

      const data = await mondayGQL(token, query)
      const item = data?.items?.[0]

      if (!item) {
        return NextResponse.json({ error: "Item niet gevonden" }, { status: 404 })
      }

      const kickoffUpdate = item.updates.find(
        (u: { text_body: string }) =>
          u.text_body.includes("KICK-OFF") || u.text_body.includes("Company name:")
      )

      if (!kickoffUpdate) {
        return NextResponse.json({
          itemName: item.name,
          kickoffText: null,
          parsed: null,
          error: "Geen kick-off update gevonden voor deze klant",
        })
      }

      const parsed = parseKickoffDirect(kickoffUpdate.text_body)

      return NextResponse.json({
        itemName: item.name,
        kickoffText: kickoffUpdate.text_body,
        parsed,
      })
    }

    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Monday API verbinding mislukt"
    console.error("Pedro Monday API error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
