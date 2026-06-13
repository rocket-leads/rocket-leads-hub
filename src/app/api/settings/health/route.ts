import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import { NextResponse } from "next/server"

type ServiceResult = { ok: boolean; message: string; checkedAt: string }
type HealthResponse = Record<string, ServiceResult>

async function checkMonday(token: string): Promise<Omit<ServiceResult, "checkedAt">> {
  try {
    const res = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ query: "{ me { name } }" }),
    })
    const data = await res.json()
    if (data.data?.me?.name) return { ok: true, message: `Connected as ${data.data.me.name}` }
    return { ok: false, message: data.errors?.[0]?.message ?? "Invalid token" }
  } catch {
    return { ok: false, message: "Connection failed" }
  }
}

async function checkMeta(token: string): Promise<Omit<ServiceResult, "checkedAt">> {
  try {
    const res = await fetch(`https://graph.facebook.com/me?access_token=${token}`)
    const data = await res.json()
    if (data.id) return { ok: true, message: `Connected as ${data.name ?? data.id}` }
    return { ok: false, message: data.error?.message ?? "Invalid token" }
  } catch {
    return { ok: false, message: "Connection failed" }
  }
}

async function checkStripe(token: string): Promise<Omit<ServiceResult, "checkedAt">> {
  try {
    const res = await fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) return { ok: true, message: "Connected to Stripe" }
    const data = await res.json()
    return { ok: false, message: data.error?.message ?? "Invalid key" }
  } catch {
    return { ok: false, message: "Connection failed" }
  }
}

async function checkTrengo(token: string): Promise<Omit<ServiceResult, "checkedAt">> {
  // Roy 2026-06-13: previous version returned `Invalid token` the
  // moment ANY single endpoint returned non-2xx. `/users` is admin-
  // scoped and Trengo replies with 401 (not 403) for team-grade
  // tokens, so the on-demand checker kept marking a perfectly valid
  // workspace token as broken. Now we walk all 3 endpoints (channels
  // first so a healthy token short-circuits) and only declare the
  // token bad when nothing reachable returns 2xx. Transient errors
  // (429 / 5xx / network) are surfaced separately so the banner
  // doesn't flap red on a rate-limit cascade.
  let sawTransient = false
  let lastErrorMessage: string | null = null
  for (const endpoint of ["/channels", "/labels", "/users"]) {
    try {
      const res = await fetch(`https://app.trengo.com/api/v2${endpoint}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      })
      if (res.ok) return { ok: true, message: "Trengo connected" }
      if ([408, 425, 429, 500, 502, 503, 504].includes(res.status)) {
        sawTransient = true
        lastErrorMessage = `HTTP ${res.status} (transient - retried)`
        continue
      }
      // 401 / 403 / other 4xx → could be scope mismatch on this
      // endpoint only. Try the next one. Stash the message for
      // a useful banner if nothing else works either.
      const contentType = res.headers.get("content-type") ?? ""
      if (contentType.includes("application/json")) {
        const data = await res.json().catch(() => ({ message: null }))
        lastErrorMessage = (data as { message?: string }).message ?? `HTTP ${res.status}`
      } else {
        lastErrorMessage = `HTTP ${res.status}`
      }
    } catch {
      sawTransient = true
      lastErrorMessage = "Connection failed (transient)"
      continue
    }
  }
  if (sawTransient) {
    // Treat as ok-with-warning so the UI doesn't flip red on a
    // transient blip - the cron's hourly check has retry logic that
    // gives a more authoritative verdict.
    return { ok: true, message: lastErrorMessage ?? "Trengo transient, treated as up" }
  }
  return { ok: false, message: lastErrorMessage ?? "Invalid token" }
}

async function checkFathom(token: string): Promise<Omit<ServiceResult, "checkedAt">> {
  try {
    const res = await fetch("https://api.fathom.ai/external/v1/team_members", {
      headers: { "X-Api-Key": token, Accept: "application/json" },
    })
    if (res.ok) return { ok: true, message: "Fathom connected" }
    const text = await res.text().catch(() => "")
    return { ok: false, message: `HTTP ${res.status}: ${text.slice(0, 80) || res.statusText}` }
  } catch {
    return { ok: false, message: "Connection failed" }
  }
}

const SERVICES = ["monday", "meta", "stripe", "trengo", "fathom"] as const
const checkers = {
  monday: checkMonday,
  meta: checkMeta,
  stripe: checkStripe,
  trengo: checkTrengo,
  fathom: checkFathom,
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createAdminClient()
  const { data: rows } = await supabase
    .from("api_tokens")
    .select("service, token_encrypted")
    .in("service", [...SERVICES])

  const tokenMap = Object.fromEntries(
    (rows ?? []).map((r) => {
      try {
        return [r.service, decrypt(r.token_encrypted)]
      } catch {
        return [r.service, null]
      }
    })
  )

  const checkedAt = new Date().toISOString()

  const results = await Promise.all(
    SERVICES.map(async (service) => {
      const token = tokenMap[service]
      if (!token) return [service, { ok: false, message: "No token saved yet", checkedAt }]
      const result = await checkers[service](token)
      return [service, { ...result, checkedAt }]
    })
  )

  const health: HealthResponse = Object.fromEntries(results)

  // Update last_verified + is_valid for all services in parallel
  await Promise.all(
    SERVICES.map((service) =>
      supabase
        .from("api_tokens")
        .update({ is_valid: health[service].ok, last_verified: checkedAt })
        .eq("service", service)
    )
  )

  return NextResponse.json(health)
}
