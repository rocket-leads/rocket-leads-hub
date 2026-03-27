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
  try {
    const res = await fetch("https://app.trengo.com/api/v2/profile", {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      return { ok: true, message: `Connected as ${data.name ?? "user"}` }
    }
    return { ok: false, message: "Invalid token" }
  } catch {
    return { ok: false, message: "Connection failed" }
  }
}

const SERVICES = ["monday", "meta", "stripe", "trengo"] as const
const checkers = { monday: checkMonday, meta: checkMeta, stripe: checkStripe, trengo: checkTrengo }

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
