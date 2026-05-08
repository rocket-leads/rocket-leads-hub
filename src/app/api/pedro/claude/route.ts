import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { auth } from "@/lib/auth"
import { loadPedroSystemPrompt } from "@/lib/pedro/knowledge"

// SDK reads ANTHROPIC_API_KEY from env automatically — same key the rest of
// the hub (watchlist, refresh-cache) uses.
const anthropic = new Anthropic()

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { prompt, maxTokens = 1000, images } = await req.json()

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 })
    }

    const content: Anthropic.MessageCreateParams["messages"][0]["content"] = []

    if (images && Array.isArray(images)) {
      for (const img of images) {
        if (img.data && img.mediaType) {
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: img.data,
            },
          })
        }
      }
    }

    content.push({ type: "text", text: prompt })

    const system = await loadPedroSystemPrompt()
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }],
    })

    const text =
      message.content[0].type === "text" ? message.content[0].text : ""

    return NextResponse.json({ text })
  } catch (e: unknown) {
    console.error("Pedro Claude API error:", e)
    const errorMessage = e instanceof Error ? e.message : "Claude API fout"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
