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

async function checkMonday(token: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ query: "{ me { name } }" }),
    })
    const data = await res.json()
    return !!data?.data?.me?.name
  } catch {
    return false
  }
}

async function checkMeta(token: string): Promise<boolean> {
  try {
    const res = await fetch(`https://graph.facebook.com/me?access_token=${token}`)
    const data = await res.json()
    return typeof data?.id === "string" && data.id.length > 0
  } catch {
    return false
  }
}

async function checkStripe(token: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}

async function checkTrengo(token: string): Promise<boolean> {
  // Roy 2026-06-09: previous early-return was flagging the Trengo token as
  // expired even when the app was happily calling /contacts + /channels +
  // /tickets all day. Root cause: `/users` requires the `admin` scope -
  // app-integration tokens typically don't have that, so it returns 403 on
  // the first endpoint. The old comment assumed "JSON 4xx is decisive" but
  // that's only true for 401 (auth invalid). 403 = scope mismatch on THIS
  // endpoint, not "token expired" - keep trying the others.
  //
  // Verdict semantics now:
  //   - any 2xx          → return true (some endpoint succeeded → token works)
  //   - 401 anywhere     → return false (auth genuinely invalid)
  //   - 403 / 5xx / etc. → keep trying - endpoint-specific scope failures
  //                         must not gate the whole-token verdict
  //   - all failed       → return false (no endpoint reachable with this token)
  for (const endpoint of ["/channels", "/labels", "/users"]) {
    try {
      const res = await fetch(`https://app.trengo.com/api/v2${endpoint}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      })
      if (res.ok) return true
      // 401 = decisive auth failure across all endpoints
      if (res.status === 401) return false
      // 403 / 429 / 5xx / non-JSON page → try the next endpoint
    } catch {
      continue
    }
  }
  return false
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
async function checkFathom(token: string): Promise<boolean | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt))
    try {
      const tm = await fetch("https://api.fathom.ai/external/v1/team_members", {
        headers: { "X-Api-Key": token, Accept: "application/json" },
        cache: "no-store",
      })
      if (tm.ok) return true
      if (tm.status === 401) return false
      if (tm.status === 403) {
        // Scope-mismatch on /team_members - try /meetings as a less-strict
        // fallback. Same X-Api-Key auth; if /meetings answers ok, the token
        // works for the Hub's actual day-to-day usage.
        const mt = await fetch(
          "https://api.fathom.ai/external/v1/meetings?limit=1",
          {
            headers: { "X-Api-Key": token, Accept: "application/json" },
            cache: "no-store",
          },
        )
        if (mt.ok) return true
        if (mt.status === 401 || mt.status === 403) return false
        // /meetings transient too - fall through to the retry loop
      }
      // 429 / 5xx / anything else → retry
    } catch {
      // network blip → retry
    }
  }
  return null
}

/** A checker returns boolean for a decisive verdict (token works or
 *  doesn't), or `null` when the call hit a transient failure (429 /
 *  5xx / network) and the cron should preserve the previous
 *  is_valid value rather than write a false negative. Only Fathom
 *  uses the `null` path today; the other services' checkers are
 *  still single-try since Roy hasn't flagged false-positive trouble
 *  on those. */
const checkers: Record<(typeof SERVICES)[number], (token: string) => Promise<boolean | null>> = {
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
