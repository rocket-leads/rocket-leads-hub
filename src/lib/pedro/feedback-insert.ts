import { createAdminClient } from "@/lib/supabase/server"
import {
  classifyFeedbackScope,
  type FeedbackScope,
} from "./feedback-scope-classifier"

/**
 * Shared writer for `pedro_creative_feedback` rows. Wraps the Haiku
 * scope classifier so every insert path (explicit feedback button,
 * regen-feedback modal, prompt-edit auto-capture, upload-image) runs
 * the same classification + writes the same shape.
 *
 * Classifier failures fall back to scope="client" inside the classifier
 * itself, so the write always succeeds — we never block the CM on a
 * model call.
 *
 * Roy 2026-06-13.
 */

export type InsertFeedbackArgs = {
  clientId: string
  feedbackType: "explicit" | "prompt_edit" | "regen" | "upload"
  feedbackText: string
  /** Optional refs for audit / pivoting back to the source generation. */
  variantId?: string | null
  variantImagePosition?: number | null
  refreshId?: string | null
  createdByEmail?: string | null
}

export type InsertFeedbackResult = {
  id: string | null
  scope: FeedbackScope
  rationale: string
}

/** One-shot classify-then-insert. The caller doesn't need to know about
 *  the classifier; the dual-loop concern lives entirely inside this
 *  helper. */
export async function insertCreativeFeedback(
  args: InsertFeedbackArgs,
): Promise<InsertFeedbackResult> {
  const supabase = await createAdminClient()
  const trimmed = args.feedbackText.trim().slice(0, 2000)

  // Light client context for the classifier — name + sector pulled from
  // pedro_client_state.brief / clients table. Best-effort; classifier
  // tolerates nulls.
  const ctx = await loadClientContextForClassifier(args.clientId)
  const verdict = await classifyFeedbackScope({
    feedbackText: trimmed,
    clientName: ctx.clientName,
    sector: ctx.sector,
    feedbackType: args.feedbackType,
  })

  const { data, error } = await supabase
    .from("pedro_creative_feedback")
    .insert({
      client_id: args.clientId,
      variant_id: args.variantId ?? null,
      variant_image_position:
        typeof args.variantImagePosition === "number" ? args.variantImagePosition : null,
      refresh_id: args.refreshId ?? null,
      feedback_type: args.feedbackType,
      feedback_text: trimmed,
      created_by_email: args.createdByEmail ?? null,
      scope: verdict.scope,
      scope_rationale: verdict.rationale,
    })
    .select("id")
    .single<{ id: string }>()

  if (error) {
    console.error(
      "[pedro/feedback-insert] insert failed:",
      error.message,
    )
    return { id: null, scope: verdict.scope, rationale: verdict.rationale }
  }
  return { id: data?.id ?? null, scope: verdict.scope, rationale: verdict.rationale }
}

async function loadClientContextForClassifier(
  clientId: string,
): Promise<{ clientName: string | null; sector: string | null }> {
  try {
    const supabase = await createAdminClient()
    const [clientRes, stateRes] = await Promise.all([
      supabase
        .from("clients")
        .select("name")
        .eq("monday_item_id", clientId)
        .maybeSingle<{ name: string | null }>(),
      supabase
        .from("pedro_client_state")
        .select("brief")
        .eq("client_id", clientId)
        .order("campaign_number", { ascending: false })
        .limit(1)
        .maybeSingle<{ brief: Record<string, unknown> | null }>(),
    ])
    const brief = stateRes.data?.brief ?? null
    const sector =
      brief && typeof brief.sector === "string" ? brief.sector.trim() || null : null
    return {
      clientName: clientRes.data?.name?.trim() || null,
      sector,
    }
  } catch {
    return { clientName: null, sector: null }
  }
}
