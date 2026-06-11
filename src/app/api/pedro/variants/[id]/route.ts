import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * PATCH /api/pedro/variants/[id]
 *  body: {
 *    hook?, primaryCopySnippet?, imagePrompt?, topicLabel?,
 *    headline?, altHeadlines?, altPrimaryTexts?, linkDescription?
 *  }
 *
 * Inline-edit endpoint for a single variant. Roy 2026-06-10: ALLE
 * tekstvelden in de variant card zijn nu click-to-edit, en die slaan
 * via dit endpoint op (single field per PATCH, debounced op blur).
 *
 * Only the provided fields are updated - omitted keys stay as-is.
 * Empty strings clear that single field, but `altHeadlines: []` /
 * `altPrimaryTexts: []` are treated as "wipe the array".
 */

const MAX_PRIMARY_CHARS = 1500
const MAX_HEADLINE_CHARS = 80
const MAX_DESC_CHARS = 200
const MAX_ALT_ITEMS = 5

function sanitiseArray(raw: unknown, maxLen: number, maxChars: number): string[] | null {
  if (raw === null) return null
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== "string") continue
    const trimmed = v.replace(/\s+/g, " ").trim()
    if (!trimmed) continue
    out.push(trimmed.slice(0, maxChars))
    if (out.length >= maxLen) break
  }
  return out
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  let body: {
    hook?: string
    primaryCopySnippet?: string
    imagePrompt?: string
    topicLabel?: string
    headline?: string
    altHeadlines?: string[] | null
    altPrimaryTexts?: string[] | null
    linkDescription?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (body.hook !== undefined) {
    update.hook = body.hook.trim().slice(0, MAX_PRIMARY_CHARS) || null
  }
  if (body.primaryCopySnippet !== undefined) {
    update.primary_copy_snippet =
      body.primaryCopySnippet.trim().slice(0, MAX_PRIMARY_CHARS) || null
  }
  if (body.imagePrompt !== undefined) {
    update.image_prompt = body.imagePrompt.trim() || null
  }
  if (body.topicLabel !== undefined) {
    update.topic_label = body.topicLabel.trim() || null
  }
  if (body.headline !== undefined) {
    update.headline = body.headline.trim().slice(0, MAX_HEADLINE_CHARS) || null
  }
  if (body.linkDescription !== undefined) {
    update.link_description =
      body.linkDescription.trim().slice(0, MAX_DESC_CHARS) || null
  }
  if (body.altHeadlines !== undefined) {
    const arr = sanitiseArray(body.altHeadlines, MAX_ALT_ITEMS, MAX_HEADLINE_CHARS)
    update.alt_headlines = arr && arr.length > 0 ? arr : null
  }
  if (body.altPrimaryTexts !== undefined) {
    const arr = sanitiseArray(body.altPrimaryTexts, MAX_ALT_ITEMS, MAX_PRIMARY_CHARS)
    update.alt_primary_texts = arr && arr.length > 0 ? arr : null
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Geen velden om te updaten" }, { status: 400 })
  }

  try {
    const supabase = await createAdminClient()
    const { data, error } = await supabase
      .from("pedro_variants")
      .update(update)
      .eq("id", id)
      .select(
        "id, hook, primary_copy_snippet, image_prompt, topic_label, headline, alt_headlines, alt_primary_texts, link_description",
      )
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: "Variant not found" }, { status: 404 })

    return NextResponse.json({
      variantId: data.id,
      hook: data.hook,
      primaryCopySnippet: data.primary_copy_snippet,
      imagePrompt: data.image_prompt,
      topicLabel: data.topic_label,
      headline: data.headline,
      altHeadlines: data.alt_headlines,
      altPrimaryTexts: data.alt_primary_texts,
      linkDescription: data.link_description,
    })
  } catch (e) {
    console.error("[pedro/variants PATCH] failed:", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 500 },
    )
  }
}
