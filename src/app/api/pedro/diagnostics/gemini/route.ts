import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

/**
 * GET /api/pedro/diagnostics/gemini
 *
 * Diagnostic endpoint for the image-gen integration. Returns:
 *   1. List of every Gemini model on this API key with "image" in the name
 *      (so we know which exact model IDs are available)
 *   2. A minimal test image-gen call result so we can see the raw error
 *      Google returns when something's wrong (model not enabled, billing
 *      not active, scope, etc.)
 *
 * Roy 2026-06-09: built after the 502 on /generate-image to figure out
 * what's actually wrong now that billing is fixed.
 */

async function getApiKey(): Promise<string> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "gemini")
    .single()
  if (!data) throw new Error("Gemini API key niet geconfigureerd")
  return decrypt(data.token_encrypted)
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let key: string
  try {
    key = await getApiKey()
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "API key niet geconfigureerd" },
      { status: 500 },
    )
  }

  // ── 1. List models with "image" in the name ─────────────────────────
  let imageModels: Array<{ name: string; description?: string; methods?: string[] }> = []
  let listError: string | null = null
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    )
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      listError = `HTTP ${res.status}: ${text.slice(0, 300)}`
    } else {
      const json = (await res.json()) as {
        models?: Array<{
          name?: string
          description?: string
          supportedGenerationMethods?: string[]
        }>
      }
      imageModels = (json.models ?? [])
        .filter((m) => (m.name ?? "").toLowerCase().includes("image"))
        .map((m) => ({
          name: (m.name ?? "").replace(/^models\//, ""),
          description: m.description?.slice(0, 200),
          methods: m.supportedGenerationMethods,
        }))
    }
  } catch (e) {
    listError = e instanceof Error ? e.message : "list failed"
  }

  // ── 2. Try a minimal image gen against the default model ────────────
  const TEST_MODEL = "gemini-3-pro-image-preview"
  type GeminiPart = {
    text?: string
    inline_data?: { mime_type?: string; data?: string }
    inlineData?: { mimeType?: string; data?: string }
  }
  type GeminiPartContent = { content?: { parts?: GeminiPart[] } }
  let testCall: {
    model: string
    httpStatus: number
    httpOk: boolean
    errorBody: string | null
    hasImageInResponse: boolean
    textInResponse: string | null
    promptFeedback: unknown
  } | null = null
  try {
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Generate a simple test image: a red circle on a white background. Return only the image.",
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
      },
    }
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TEST_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    )
    if (!res.ok) {
      const errorBody = await res.text().catch(() => "")
      testCall = {
        model: TEST_MODEL,
        httpStatus: res.status,
        httpOk: false,
        errorBody: errorBody.slice(0, 600),
        hasImageInResponse: false,
        textInResponse: null,
        promptFeedback: null,
      }
    } else {
      const json = (await res.json()) as {
        candidates?: GeminiPartContent[]
        promptFeedback?: unknown
      }
      // Walk candidates → parts to detect inline_data or inlineData.
      let hasImage = false
      let textPart: string | null = null
      for (const c of json.candidates ?? []) {
        for (const p of c.content?.parts ?? []) {
          if (p.inline_data?.data || p.inlineData?.data) hasImage = true
          if (p.text) textPart = p.text.slice(0, 300)
        }
      }
      testCall = {
        model: TEST_MODEL,
        httpStatus: res.status,
        httpOk: true,
        errorBody: null,
        hasImageInResponse: hasImage,
        textInResponse: textPart,
        promptFeedback: json.promptFeedback ?? null,
      }
    }
  } catch (e) {
    testCall = {
      model: TEST_MODEL,
      httpStatus: 0,
      httpOk: false,
      errorBody: e instanceof Error ? e.message : String(e),
      hasImageInResponse: false,
      textInResponse: null,
      promptFeedback: null,
    }
  }

  return NextResponse.json({
    apiKeyConfigured: true,
    imageModelsListed: imageModels.length,
    imageModels,
    listError,
    testCall,
  })
}
