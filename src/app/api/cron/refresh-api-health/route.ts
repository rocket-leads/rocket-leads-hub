import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"

/**
 * Hourly token-validity check.
 *
 * Pings every external integration's "who am I" endpoint with the
 * decrypted token, writes `is_valid` + `last_verified` back to
 * `api_tokens`. The ApiHealthBanner reads that column via
 * /api/settings/health/status so a freshly-expired token surfaces
 * within ~1 hour even when nobody visits Settings.
 *
 * Mirrors the validation logic in /api/settings/health (GET handler)
 * but skips the auth gate - replaces it with the cron secret check.
 * Kept duplicated rather than imported because settings/health is a
 * page-facing route and we don't want a coupling that drags page
 * concerns into the cron run.
 */

export const maxDuration = 60

const SERVICES = ["monday", "meta", "stripe", "trengo", "fathom"] as const

/** Statuses that mean "the server is alive but having a moment" — never
 *  treat these as a token failure. Retry, and if every attempt is also
 *  transient, return null so the cron preserves the previous is_valid
 *  value rather than flapping the banner red. */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

const REQUEST_TIMEOUT_MS = 10_000
const RETRY_ATTEMPTS = 3
const RETRY_BACKOFF_MS = 1500

/** Verdict semantics shared by every checker:
 *   true   - decisive: the token works
 *   false  - decisive: the token is bad (401/403 from a definitive endpoint)
 *   null   - transient (429/5xx/network/timeout) — preserve previous state
 */
type Verdict = boolean | null

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" })
  } finally {
    clearTimeout(timer)
  }
}

/** Run `fn` up to RETRY_ATTEMPTS times with linear backoff. Returns the
 *  first decisive verdict (true/false); only returns null if every
 *  attempt was transient. Keeps total worst-case at ~10s × 3 + backoff. */
async function retryTransient(fn: () => Promise<Verdict>): Promise<Verdict> {
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * attempt))
    }
    const v = await fn()
    if (v !== null) return v
  }
  return null
}

async function checkMonday(token: string): Promise<Verdict> {
  return retryTransient(async () => {
    try {
      const res = await fetchWithTimeout("https://api.monday.com/v2", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token },
        body: JSON.stringify({ query: "{ me { name } }" }),
      })
      if (res.status === 401 || res.status === 403) return false
      if (TRANSIENT_STATUSES.has(res.status)) return null
      const data = await res.json().catch(() => null)
      // Monday returns 200 with an `errors` array for auth failures —
      // missing me.name on a 200 also means the query failed (typically
      // bad/expired token).
      if (data?.data?.me?.name) return true
      return false
    } catch {
      return null
    }
  })
}

async function checkMeta(token: string): Promise<Verdict> {
  return retryTransient(async () => {
    try {
      const res = await fetchWithTimeout(
        `https://graph.facebook.com/me?access_token=${token}`,
        {},
      )
      if (TRANSIENT_STATUSES.has(res.status)) return null
      const data = await res.json().catch(() => null)
      if (typeof data?.id === "string" && data.id.length > 0) return true
      // Meta surfaces auth errors as 4xx + an `error` object. Anything
      // other than a transient status + no id = bad token.
      return false
    } catch {
      return null
    }
  })
}

async function checkStripe(token: string): Promise<Verdict> {
  return retryTransient(async () => {
    try {
      const res = await fetchWithTimeout("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) return true
      if (res.status === 401 || res.status === 403) return false
      if (TRANSIENT_STATUSES.has(res.status)) return null
      // Stripe rarely returns other 4xx for /balance — treat as bad token.
      return false
    } catch {
      return null
    }
  })
}

async function checkTrengo(token: string): Promise<Verdict> {
  // Multi-endpoint walk because individual endpoints fail with 403 when
  // the token lacks per-endpoint scope (admin etc.) — that's not a bad
  // token. The decisive verdict comes from the WORST signal across all
  // endpoints:
  //   - any 2xx        → true (token works for at least one endpoint)
  //   - 401 anywhere   → false (auth invalid across the board)
  //   - all transient  → null (every endpoint was 429/5xx/network — retry)
  //   - all 4xx-other  → false (nothing reachable with this token)
  return retryTransient(async () => {
    let sawTransient = false
    for (const endpoint of ["/channels", "/labels", "/users"]) {
      try {
        const res = await fetchWithTimeout(
          `https://app.trengo.com/api/v2${endpoint}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
        )
        if (res.ok) return true
        if (res.status === 401) return false
        if (TRANSIENT_STATUSES.has(res.status)) {
          sawTransient = true
          continue
        }
        // 403 / non-JSON page / other 4xx → try the next endpoint
      } catch {
        sawTransient = true
        continue
      }
    }
    // If at least one endpoint was transient, the whole check is
    // transient — retry the outer loop before deciding the token is bad.
    return sawTransient ? null : false
  })
}

/**
 * Roy 2026-06-09: two failure modes to distinguish here.
 *
 *  Transient (network blip / 429 / 5xx) → return null so the cron preserves
 *  the previous is_valid value rather than flapping the banner on every
 *  Fathom hiccup. Up to 3 attempts with backoff before giving up.
 *
 *  Endpoint-scope (403 on /team_members because the API key is team-member
 *  level, not team-admin) → fall back to /meetings, which most app usage
 *  actually targets and accepts the same auth without the admin scope. If
 *  /meetings answers 2xx, the token is fine for what the Hub does with it.
 *
 *  Hard auth (401, or 403 across both endpoints) → return false. Genuine
 *  bad/revoked key, banner should fire.
 *
 *  The /team_members → /meetings fallback was added because /team_members
 *  was flagging Fathom as "expired" for tokens that worked fine for the
 *  app's actual operations (which call /meetings + /team_members both,
 *  but only /team_members would fail with the lower-scope keys).
 */
async function checkFathom(token: string): Promise<Verdict> {
  return retryTransient(async () => {
    try {
      const tm = await fetchWithTimeout(
        "https://api.fathom.ai/external/v1/team_members",
        { headers: { "X-Api-Key": token, Accept: "application/json" } },
      )
      if (tm.ok) return true
      if (tm.status === 401) return false
      if (tm.status === 403) {
        // Scope-mismatch on /team_members — try /meetings as a less-strict
        // fallback. Same X-Api-Key auth; if /meetings answers ok, the token
        // works for the Hub's actual day-to-day usage.
        const mt = await fetchWithTimeout(
          "https://api.fathom.ai/external/v1/meetings?limit=1",
          { headers: { "X-Api-Key": token, Accept: "application/json" } },
        )
        if (mt.ok) return true
        if (mt.status === 401 || mt.status === 403) return false
        if (TRANSIENT_STATUSES.has(mt.status)) return null
        return false
      }
      if (TRANSIENT_STATUSES.has(tm.status)) return null
      return false
    } catch {
      return null
    }
  })
}

/** Every checker now returns the unified Verdict (boolean | null) — see
 *  the type docstring. `null` from any checker preserves the previous
 *  `is_valid` on the row instead of flapping the banner red on a
 *  one-off transient. */
const checkers: Record<(typeof SERVICES)[number], (token: string) => Promise<Verdict>> = {
  monday: checkMonday,
  meta: checkMeta,
  stripe: checkStripe,
  trengo: checkTrengo,
  fathom: checkFathom,
}

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tracker = startCronRun("refresh-api-health")
  const supabase = await createAdminClient()
  const checkedAt = new Date().toISOString()

  try {
    const { data: rows } = await supabase
      .from("api_tokens")
      .select("service, token_encrypted")
      .in("service", [...SERVICES])

    const summary: Record<string, { ok: boolean; flipped: boolean }> = {}
    const previousValidity = new Map<string, boolean>()

    // Pull prior is_valid so we can log how many tokens flipped (good
    // visibility into "was Meta just newly broken or has it been broken").
    const { data: prior } = await supabase
      .from("api_tokens")
      .select("service, is_valid")
      .in("service", [...SERVICES])
    for (const r of prior ?? []) {
      previousValidity.set(r.service, !!r.is_valid)
    }

    await Promise.all(
      SERVICES.map(async (service) => {
        const row = (rows ?? []).find((r) => r.service === service)
        if (!row?.token_encrypted) {
          summary[service] = { ok: false, flipped: previousValidity.get(service) === true }
          return
        }

        let token: string
        try {
          token = decrypt(row.token_encrypted)
        } catch {
          summary[service] = { ok: false, flipped: previousValidity.get(service) === true }
          return
        }

        const result = await checkers[service](token)
        const previous = previousValidity.get(service)

        // result === null → transient (Fathom 429/5xx/network blip).
        // Preserve the previous is_valid so we don't flip the UI to
        // "broken" on a temporary outage. Stamp last_verified so the
        // "last checked" timestamp doesn't go stale.
        if (result === null) {
          summary[service] = { ok: previous ?? false, flipped: false }
          await supabase
            .from("api_tokens")
            .update({ last_verified: checkedAt })
            .eq("service", service)
          return
        }

        summary[service] = { ok: result, flipped: previous !== undefined && previous !== result }

        await supabase
          .from("api_tokens")
          .update({ is_valid: result, last_verified: checkedAt })
          .eq("service", service)
      }),
    )

    const totalInvalid = Object.values(summary).filter((s) => !s.ok).length
    const newlyBroken = Object.entries(summary)
      .filter(([, s]) => !s.ok && s.flipped)
      .map(([svc]) => svc)
    const newlyFixed = Object.entries(summary)
      .filter(([, s]) => s.ok && s.flipped)
      .map(([svc]) => svc)

    const metrics = { summary, totalInvalid, newlyBroken, newlyFixed }
    if (totalInvalid > 0) {
      await tracker.partial(`${totalInvalid} service(s) invalid: ${Object.entries(summary).filter(([, s]) => !s.ok).map(([svc]) => svc).join(", ")}`, metrics)
    } else {
      await tracker.ok(metrics)
    }

    return NextResponse.json({ ok: true, summary, totalInvalid, newlyBroken, newlyFixed })
  } catch (e) {
    await tracker.fail(e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 })
  }
}
