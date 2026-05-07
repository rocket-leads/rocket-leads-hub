import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = req.nextUrl.searchParams.get("url")
  if (!url) {
    return NextResponse.json({ error: "URL is vereist" }, { status: 400 })
  }

  try {
    let fetchUrl = url.trim()
    if (!fetchUrl.startsWith("http")) fetchUrl = `https://${fetchUrl}`

    const res = await fetch(fetchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PedroBot/1.0)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      return NextResponse.json({ error: `Website niet bereikbaar (${res.status})` }, { status: 400 })
    }

    const html = await res.text()
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 5000)

    return NextResponse.json({ content: cleaned })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fetch mislukt"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
