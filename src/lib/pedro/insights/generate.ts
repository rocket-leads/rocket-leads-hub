import Anthropic from "@anthropic-ai/sdk"
import { createAdminClient } from "@/lib/supabase/server"
import { validateAiOutput, stripAiTells } from "@/lib/ai/guardrails"
import type { ClientAiContext } from "./context"
import type { InsightType, InsightSeverity } from "./types"
import { INSIGHT_REGISTRY } from "./registry"
import type { Locale } from "@/lib/i18n/types"

const anthropic = new Anthropic()

export type GenerateInsightResult = {
  /** Normalised result body. Always present unless the registry skipped generation. */
  body: string | null
  /** Severity hint when the prompt produces one. v1 has none - null. */
  severity: InsightSeverity | null
  /** Guardrail violations detected post-generation. Logged + persisted but
   *  the insight still ships unless caller checks .ok = false. */
  violations: ReturnType<typeof validateAiOutput>
  /** True when generation ran cleanly (model returned text, no upstream error).
   *  False when the prompt was skipped, the API errored, or output was empty.
   *  Independent of guardrail violations - caller can decide if violations
   *  count as a hard failure. */
  ok: boolean
  /** Short reason when ok=false. */
  skippedReason?: string
}

/**
 * Generate a single insight for a single client and persist it to
 * `pedro_insights`. The cron calls this in a loop fanning out across
 * (client × insight_type).
 *
 * Resilience contract:
 *   - Registry's shouldGenerate gate → return early, don't write.
 *   - Anthropic error → skip the upsert (keep the previous row stale-but-
 *     present rather than corrupt with an error message).
 *   - Empty output → skip the upsert.
 *   - Guardrail violations → still upsert; consumer logs the violations.
 *     Hard-failing here would mean a single regex misfire takes down a
 *     dashboard surface; soft failure means the dashboard stays useful
 *     while we triage the prompt.
 */
export async function generateAndPersistInsight(
  type: InsightType,
  ctx: ClientAiContext,
  locale: Locale,
): Promise<GenerateInsightResult> {
  const entry = INSIGHT_REGISTRY[type]
  if (entry.shouldGenerate && !entry.shouldGenerate(ctx)) {
    return {
      body: null,
      severity: null,
      violations: [],
      ok: false,
      skippedReason: "registry shouldGenerate gate returned false",
    }
  }

  const systemPrompt = entry.systemPrompt(ctx, locale)
  const userPrompt = entry.userPrompt(ctx)

  let text = ""
  try {
    const msg = await anthropic.messages.create({
      model: entry.model,
      max_tokens: entry.maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    })
    text = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : ""
  } catch (e) {
    console.error(
      `[pedro/insights] generation failed for ${ctx.clientId}/${type}:`,
      e instanceof Error ? e.message : e,
    )
    return {
      body: null,
      severity: null,
      violations: [],
      ok: false,
      skippedReason: e instanceof Error ? e.message : "unknown anthropic error",
    }
  }

  if (!text) {
    return {
      body: null,
      severity: null,
      violations: [],
      ok: false,
      skippedReason: "empty response",
    }
  }

  // Strip stray quotes / dash prefixes some prompts produce despite instruction,
  // and run the AI-tell sanitiser to convert any em-dashes / en-dashes the model
  // leaked through into plain commas. The sanitiser is idempotent and a no-op
  // for clean output, so applying it unconditionally is safe.
  //
  // We also strip leading markdown code fences (```json ... ```) and the
  // leftover `json\n` language tag - Haiku wraps JSON output in fences even
  // when the prompt forbids it, and without this the stored body becomes a
  // literal "json\n{...}" string that fails JSON.parse downstream.
  const cleaned = stripAiTells(
    text
      .replace(/^```[a-zA-Z]*\s*\n?/, "")
      .replace(/\n?```\s*$/, "")
      .replace(/^(?:json|JSON)\s*\n+/, "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/^[-•]\s*/, "")
      .trim(),
  )

  const violations = validateAiOutput(cleaned, {
    mondayCrmConnected: ctx.sources.mondayUpdates,
  })
  if (violations.length > 0) {
    console.warn(
      `[pedro/insights] ${ctx.clientId}/${type} ${violations.length} guardrail violations:`,
      violations.map((v) => v.rule).join(", "),
    )
  }

  // Upsert into pedro_insights - one row per (client, type).
  try {
    const supabase = await createAdminClient()
    await supabase.from("pedro_insights").upsert(
      {
        monday_item_id: ctx.clientId,
        insight_type: type,
        body: cleaned,
        severity: null,
        sources_used: ctx.sources as unknown as Record<string, unknown>,
        guardrail_violations: violations as unknown as Record<string, unknown>[],
        prompt_version: entry.promptVersion,
        model: entry.model,
        generated_at: new Date().toISOString(),
        // No expiry for v1 - every cron tick refreshes everything.
        expires_at: null,
      },
      { onConflict: "monday_item_id,insight_type" },
    )
  } catch (e) {
    console.error(
      `[pedro/insights] upsert failed for ${ctx.clientId}/${type}:`,
      e instanceof Error ? e.message : e,
    )
    return {
      body: cleaned,
      severity: null,
      violations,
      ok: false,
      skippedReason: "supabase upsert failed",
    }
  }

  return { body: cleaned, severity: null, violations, ok: true }
}
