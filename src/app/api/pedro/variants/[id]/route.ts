import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * PATCH /api/pedro/variants/[id]
 *  body: { hook?, primaryCopySnippet?, imagePrompt? }
 *
 * Inline-edit endpoint for a single variant. Used by CreativeRefresh's
 * edit-mode UI: the CM can tune the hook + primary copy of a specific
 * variant before regenerating images so the new creatives match the
 * angle they actually want to ship.
 *
 * Only the provided fields are updated — omitted keys stay as-is.
 * Empty strings are treated as "clear this field" so a CM can wipe
 * content they don't want.
 *
 * Roy 2026-06-09.
 */

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
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Build the update object only with fields the caller explicitly
  // included. Sending `{ hook: "" }` clears the hook; omitting `hook`
  // leaves it untouched.
  const update: Record<string, string | null> = {}
  if (body.hook !== undefined) update.hook = body.hook.trim() || null
  if (body.primaryCopySnippet !== undefined) {
    update.primary_copy_snippet = body.primaryCopySnippet.trim() || null
  }
  if (body.imagePrompt !== undefined) {
    update.image_prompt = body.imagePrompt.trim() || null
  }
  if (body.topicLabel !== undefined) {
    update.topic_label = body.topicLabel.trim() || null
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
      .select("id, hook, primary_copy_snippet, image_prompt, topic_label")
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: "Variant not found" }, { status: 404 })

    return NextResponse.json({
      variantId: data.id,
      hook: data.hook,
      primaryCopySnippet: data.primary_copy_snippet,
      imagePrompt: data.image_prompt,
      topicLabel: data.topic_label,
    })
  } catch (e) {
    console.error("[pedro/variants PATCH] failed:", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 500 },
    )
  }
}
