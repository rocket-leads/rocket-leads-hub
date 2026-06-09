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
 * but skips the auth gate — replaces it with the cron secret check.
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
  for (const endpoint of ["/users", "/labels", "/channels"]) {
    try {
      const res = await fetch(`https://app.trengo.com/api/v2${endpoint}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      })
      const contentType = res.headers.get("content-type") ?? ""
      if (!contentType.includes("application/json")) continue
      if (res.ok) return true
      // Hit a JSON 4xx → token is decisively invalid (no point trying
      // other endpoints since they'll return the same auth verdict).
      return false
    } catch {
      continue
    }
  }
  return false
}

/**
 * Roy 2026-06-09: the previous one-shot check was flagging the Fathom
 * token as invalid whenever Fathom rate-limited (429) or hiccuped (5xx),
 * which then surfaced in /settings as "Fathom token expired" until the
 * next cron tick an hour later. Distinguish the failure modes:
 *
 *   - 401 / 403         → token is genuinely invalid. Flag it.
 *   - 429 / 5xx / fetch → transient. Try up to two more times with
 *                         backoff; if every attempt is transient,
 *                         return `null` so the cron preserves the
 *                         previous is_valid value (no false negative).
 *   - 2xx               → ok.
 */
async function checkFathom(token: string): Promise<boolean | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt))
    try {
      const res = await fetch("https://api.fathom.ai/external/v1/team_members", {
        headers: { "X-Api-Key": token, Accept: "application/json" },
        cache: "no-store",
      })
      if (res.ok) return true
      if (res.status === 401 || res.status === 403) return false
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
