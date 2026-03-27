import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import { NextRequest, NextResponse } from "next/server"

type TestResult = { ok: boolean; message: string }

async function testMonday(token: string): Promise<TestResult> {
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

async function testMeta(token: string): Promise<TestResult> {
  try {
    const res = await fetch(`https://graph.facebook.com/me?access_token=${token}`)
    const data = await res.json()
    if (data.id) return { ok: true, message: `Connected as ${data.name ?? data.id}` }
    return { ok: false, message: data.error?.message ?? "Invalid token" }
  } catch {
    return { ok: false, message: "Connection failed" }
  }
}

async function testStripe(token: string): Promise<TestResult> {
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

async function testTrengo(token: string): Promise<TestResult> {
  const trimmed = token.trim()
  // Try several endpoints — Trengo's /profile returns HTML; /users and /labels are more reliable
  const endpoints = ["/users", "/labels", "/channels"]
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`https://app.trengo.com/api/v2${endpoint}`, {
        headers: { Authorization: `Bearer ${trimmed}`, Accept: "application/json" },
      })
      const contentType = res.headers.get("content-type") ?? ""
      if (!contentType.includes("application/json")) continue
      const data = await res.json()
      if (res.ok) return { ok: true, message: `Trengo connected (via ${endpoint})` }
      // Got JSON error — token reached the API, return the actual error
      return { ok: false, message: `Trengo: ${data.message ?? data.error ?? `HTTP ${res.status} on ${endpoint}`}` }
    } catch {
      continue
    }
  }
  return {
    ok: false,
    message: "Trengo returned HTML for all endpoints — token likely invalid. In Trengo go to Settings → Apps & Integrations → API and create a new Personal Access Token.",
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { service } = await req.json()

  // Load token from Supabase
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", service)
    .single()

  if (!data) {
    return NextResponse.json({ ok: false, message: "No token saved yet" })
  }

  let token: string
  try {
    token = decrypt(data.token_encrypted)
  } catch {
    return NextResponse.json({ ok: false, message: "Failed to decrypt token" })
  }

  let result: TestResult
  switch (service) {
    case "monday": result = await testMonday(token); break
    case "meta": result = await testMeta(token); break
    case "stripe": result = await testStripe(token); break
    case "trengo": result = await testTrengo(token); break
    default: return NextResponse.json({ ok: false, message: "Unknown service" })
  }

  // Update last_verified + is_valid in Supabase
  await supabase
    .from("api_tokens")
    .update({ is_valid: result.ok, last_verified: new Date().toISOString() })
    .eq("service", service)

  return NextResponse.json(result)
}
