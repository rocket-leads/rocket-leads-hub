/**
 * Wrap a fetch / external call so failures fall back to a default value
 * *and* leave a searchable breadcrumb. Replaces the `.catch(() => [])`
 * pattern that swallows errors silently - those are the bugs that take
 * weeks to find (see: empty Users tab, 2026-05-21).
 *
 * Why a helper instead of let-callers-do-it:
 *   - Forces a `label` so Vercel-logs grep finds the call site instantly
 *   - One place to add structured error reporting later (Sentry, a
 *     `client_errors` table, Slack ping, etc) without touching every
 *     call site
 *   - Removes the temptation to drop a bare `.catch(() => [])` that
 *     hides everything including bugs in your own code (typos,
 *     undefined accesses, etc - they all become "empty result")
 *
 * Usage:
 *   const channels = await safeFetch(
 *     "settings:trengoChannels",
 *     () => fetchTrengoChannels(),
 *     [],
 *   )
 */
export async function safeFetch<T, F>(
  label: string,
  fn: () => Promise<T>,
  fallback: F,
): Promise<T | F> {
  try {
    return await fn()
  } catch (e) {
    const err =
      e instanceof Error
        ? { message: e.message, name: e.name, stack: e.stack?.split("\n").slice(0, 4).join("\n") }
        : { value: String(e) }
    console.error(`[safeFetch] ${label} failed:`, err)
    return fallback
  }
}
