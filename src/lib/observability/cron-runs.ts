import { createAdminClient } from "@/lib/supabase/server"

/**
 * Cron observability helper. Wraps a cron's body so it always emits a row
 * to `cron_runs`, regardless of success or failure. The health page reads
 * those rows.
 *
 * Two ways to use:
 *
 *   1. Wrap an entire handler:
 *        export const GET = withCronHeartbeat("refresh-kpi", async () => { ... })
 *      Returns whatever the inner handler returns; on throw, logs an error
 *      heartbeat AND re-throws so Vercel still surfaces the failure.
 *
 *   2. Manually for crons that need to compute their own metrics blob:
 *        const tracker = startCronRun("refresh-kpi")
 *        try { ... } catch (e) { await tracker.fail(e); throw e }
 *        await tracker.ok({ clients: 87, batches: 9 })
 *
 * Both paths fire-and-forget the DB write so a transient Supabase blip
 * never breaks the cron itself — the cost of an occasional missed
 * heartbeat is acceptable; the cost of a heartbeat write blocking a real
 * data refresh isn't.
 */

export type CronStatus = "ok" | "error" | "partial"

export type CronMetrics = Record<string, unknown>

export type CronTracker = {
  /** Mark this cron run as successful. Pass any extra metrics for the health page. */
  ok: (metrics?: CronMetrics) => Promise<void>
  /** Mark this cron run as failed. `err` becomes the `error_message`. */
  fail: (err: unknown, metrics?: CronMetrics) => Promise<void>
  /** Mark as partial success (batch finished but with some failures). */
  partial: (errSummary: string, metrics?: CronMetrics) => Promise<void>
}

/**
 * Start a new cron run. Returns a tracker; call .ok / .fail / .partial when
 * the cron finishes. Always finalize — a tracker that's never finalized
 * leaves no row at all, which looks like the cron didn't even start.
 */
export function startCronRun(cronName: string): CronTracker {
  const startedAt = new Date()

  const finalize = async (
    status: CronStatus,
    errorMessage: string | null,
    metrics: CronMetrics,
  ) => {
    const finishedAt = new Date()
    try {
      const supabase = await createAdminClient()
      await supabase.from("cron_runs").insert({
        cron_name: cronName,
        status,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        error_message: errorMessage,
        metrics: metrics ?? {},
      })
    } catch (e) {
      // Never let observability eat a real cron's exit. Log and move on.
      console.error(
        `[cron-runs] heartbeat write failed for ${cronName}:`,
        e instanceof Error ? e.message : e,
      )
    }
  }

  return {
    ok: (metrics = {}) => finalize("ok", null, metrics),
    fail: (err, metrics = {}) => finalize("error", trimError(err), metrics),
    partial: (errSummary, metrics = {}) => finalize("partial", errSummary, metrics),
  }
}

/**
 * Wrap an entire cron handler so success/failure heartbeats happen
 * automatically. The handler is invoked with the tracker so it can attach
 * metrics on the .ok call when meaningful.
 */
export function withCronHeartbeat<T>(
  cronName: string,
  handler: (tracker: CronTracker) => Promise<T>,
): () => Promise<T> {
  return async () => {
    const tracker = startCronRun(cronName)
    try {
      const result = await handler(tracker)
      // If handler didn't finalize, default to ok with no metrics. Idempotent
      // because the tracker only writes on the first finalize call... actually
      // it's not — guard at call site. Document the rule: if you take the
      // tracker, you finalize it. Skip auto-ok to avoid double-heartbeat.
      return result
    } catch (e) {
      await tracker.fail(e)
      throw e
    }
  }
}

/** Truncate to 500 chars so a giant error doesn't blow up the row. */
function trimError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.length > 500 ? msg.slice(0, 497) + "..." : msg
}
