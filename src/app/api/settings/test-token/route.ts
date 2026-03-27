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
  // Trengo supports both "Bearer" and "Token" prefix depending on token type
  for (const prefix of ["Bearer", "Token"]) {
    try {
      const res = await fetch("https://app.trengo.com/api/v2/profile", {
        headers: { Authorization: `${prefix} ${trimmed}`, Accept: "application/json" },
      })
      const contentType = res.headers.get("content-type") ?? ""
      if (!contentType.includes("application/json")) continue // try next prefix
      const data = await res.json()
      if (res.ok) return { ok: true, message: `Connected as ${data.name ?? data.email ?? "user"} (${prefix})` }
    } catch {
      continue
    }
  }
  return { ok: false, message: "Invalid token — both Bearer and Token formats failed. Check your Trengo API token in Settings → Apps → API." }
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
