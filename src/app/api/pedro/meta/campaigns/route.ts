import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getToken } from "@/lib/integrations/meta"

const GRAPH_API = "https://graph.facebook.com/v19.0"

interface MetaAd {
  id: string
  name: string
  body: string
  title: string
  imageUrl: string
  accountName: string
  campaignName: string
}

interface GraphAdCreative {
  body?: string
  title?: string
  image_url?: string
}

interface GraphAd {
  id: string
  name: string
  creative?: GraphAdCreative
}

interface GraphCampaign {
  id: string
  name: string
  status: string
}

interface GraphAdAccount {
  id: string
  name: string
}

async function metaFetch<T>(
  path: string,
  token: string,
  params: Record<string, string> = {}
): Promise<T> {
  const url = new URL(`${GRAPH_API}${path}`)
  url.searchParams.set("access_token", token)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  const res = await fetch(url.toString())
  const data = await res.json()

  if (data.error) {
    const code = data.error.code
    if (code === 4 || code === 17 || code === 32) {
      throw new Error("RATE_LIMIT")
    }
    throw new Error(data.error.message || "Meta API error")
  }
  return data
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let token: string
  try {
    token = await getToken()
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Meta token error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  try {
    const accountsRes = await metaFetch<{ data: GraphAdAccount[] }>(
      "/me/adaccounts",
      token,
      { fields: "id,name", limit: "50" }
    )
    const accounts = accountsRes.data || []

    if (accounts.length === 0) {
      return NextResponse.json({ error: "Geen ad accounts gevonden", ads: [] }, { status: 200 })
    }

    const allAds: MetaAd[] = []

    for (const account of accounts) {
      try {
        const campaignsRes = await metaFetch<{ data: GraphCampaign[] }>(
          `/${account.id}/campaigns`,
          token,
          {
            fields: "id,name,status",
            filtering: JSON.stringify([{ field: "name", operator: "CONTAIN", value: "RL" }]),
            effective_status: JSON.stringify(["ACTIVE"]),
            limit: "25",
          }
        )
        const campaigns = campaignsRes.data || []

        for (const campaign of campaigns) {
          try {
            const adsRes = await metaFetch<{ data: GraphAd[] }>(
              `/${account.id}/ads`,
              token,
              {
                fields: "name,creative{body,title,image_url}",
                filtering: JSON.stringify([
                  { field: "campaign.id", operator: "EQUAL", value: campaign.id },
                ]),
                effective_status: JSON.stringify(["ACTIVE"]),
                limit: "10",
              }
            )
            const ads = adsRes.data || []

            for (const ad of ads) {
              const creative = ad.creative
              if (creative?.body || creative?.title) {
                allAds.push({
                  id: ad.id,
                  name: ad.name,
                  body: creative.body || "",
                  title: creative.title || "",
                  imageUrl: creative.image_url || "",
                  accountName: account.name,
                  campaignName: campaign.name,
                })
              }
            }
          } catch (e) {
            console.error(`Pedro: Error fetching ads for campaign ${campaign.id}:`, e)
          }
        }
      } catch (e) {
        console.error(`Pedro: Error fetching campaigns for account ${account.id}:`, e)
      }
    }

    if (allAds.length === 0) {
      return NextResponse.json({ ads: [], error: "Geen actieve RL campagnes gevonden" })
    }

    return NextResponse.json({ ads: allAds })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Meta API error"
    if (msg === "RATE_LIMIT") {
      return NextResponse.json(
        { error: "Meta API limiet bereikt - probeer het over een minuut opnieuw" },
        { status: 429 }
      )
    }
    console.error("Pedro Meta API error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
