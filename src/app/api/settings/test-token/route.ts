import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import { NextRequest, NextResponse } from "next/server"
import { google } from "googleapis"

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

async function testGoogleDrive(token: string): Promise<TestResult> {
  try {
    let keyJson: { client_email?: string; private_key?: string }
    try {
      keyJson = JSON.parse(token.trim())
    } catch {
      return { ok: false, message: "Token is not valid JSON — paste the full service-account file contents" }
    }
    if (!keyJson.client_email || !keyJson.private_key) {
      return { ok: false, message: "Service-account JSON is missing client_email or private_key" }
    }
    const authClient = new google.auth.GoogleAuth({
      credentials: keyJson,
      scopes: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ],
    })
    const client = await authClient.getClient()
    const accessToken = await client.getAccessToken()
    if (accessToken?.token) {
      return { ok: true, message: `Connected as ${keyJson.client_email}` }
    }
    return { ok: false, message: "Couldn't acquire access token" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Connection failed" }
  }
}

async function testSlack(token: string): Promise<TestResult> {
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${token.trim()}` },
    })
    const data = await res.json()
    if (data.ok) return { ok: true, message: `Connected as ${data.user} (workspace: ${data.team})` }
    return { ok: false, message: data.error ?? "Invalid token" }
  } catch {
    return { ok: false, message: "Connection failed" }
  }
}

async function testTrengo(token: string): Promise<TestResult> {
  // Roy 2026-06-09: previous version returned on the FIRST endpoint's
  // verdict — which broke when `/users` returned 403 (admin scope only) on
  // app-integration tokens that worked fine for /contacts + /channels +
  // /tickets. Order endpoints from least-strict to most-strict, and only
  // hard-fail on 401 (auth itself is invalid) or after all endpoints fail.
  // 403/HTML/transient on any one endpoint → keep trying.
  const trimmed = token.trim()
  const endpoints = ["/channels", "/labels", "/teams", "/users"]
  let lastError = ""
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`https://app.trengo.com/api/v2${endpoint}`, {
        headers: { Authorization: `Bearer ${trimmed}`, Accept: "application/json" },
      })
      if (res.ok) return { ok: true, message: `Trengo connected (via ${endpoint})` }
      // 401 = auth itself is bad — decisive across every endpoint.
      if (res.status === 401) {
        const data = await res.json().catch(() => ({})) as { message?: string; error?: string }
        return {
          ok: false,
          message: `Trengo HTTP 401: ${data.message ?? data.error ?? "Unauthorized"}`,
        }
      }
      // 403 / non-JSON / 5xx → record + keep trying the other endpoints.
      const contentType = res.headers.get("content-type") ?? ""
      if (contentType.includes("application/json")) {
        const data = await res.json().catch(() => ({})) as { message?: string; error?: string }
        lastError = `${endpoint} HTTP ${res.status}: ${data.message ?? data.error ?? "unknown"}`
      } else {
        const body = await res.text().catch(() => "")
        lastError = `${endpoint} HTTP ${res.status} non-JSON: ${body.slice(0, 80)}`
      }
    } catch (e) {
      lastError = `${endpoint} fetch error: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  return { ok: false, message: `All Trengo endpoints failed — last: ${lastError}` }
}

async function testFathom(token: string): Promise<TestResult> {
  // Roy 2026-06-09: /team_members requires the team-admin scope on the
  // API key. Lower-scope keys return 403 there but work fine on /meetings,
  // which is what the Hub actually uses day-to-day. Same fallback chain
  // as the cron's checkFathom — if /meetings succeeds, the token is valid
  // for our usage even if /team_members would 403.
  const key = token.trim()
  try {
    const tm = await fetch("https://api.fathom.ai/external/v1/team_members", {
      headers: { "X-Api-Key": key, Accept: "application/json" },
    })
    if (tm.ok) {
      const data = await tm.json().catch(() => ({})) as { items?: Array<{ name?: string }> }
      const count = data.items?.length ?? 0
      return { ok: true, message: `Connected to Fathom (${count} team member${count === 1 ? "" : "s"} visible)` }
    }
    if (tm.status === 401) {
      return { ok: false, message: `Fathom HTTP 401: token unauthorized` }
    }
    if (tm.status === 403) {
      // Scope-mismatch on /team_members — try /meetings before giving up.
      const mt = await fetch("https://api.fathom.ai/external/v1/meetings?limit=1", {
        headers: { "X-Api-Key": key, Accept: "application/json" },
      })
      if (mt.ok) {
        return {
          ok: true,
          message: `Connected to Fathom via /meetings (key lacks team-admin scope, but that's fine)`,
        }
      }
      const text = await mt.text().catch(() => "")
      return {
        ok: false,
        message: `Fathom HTTP ${mt.status} on /meetings (also 403 on /team_members): ${text.slice(0, 120) || mt.statusText}`,
      }
    }
    const text = await tm.text().catch(() => "")
    return { ok: false, message: `Fathom HTTP ${tm.status}: ${text.slice(0, 120) || tm.statusText}` }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Connection failed" }
  }
}

async function testGemini(token: string): Promise<TestResult> {
  // Cheapest validity probe: list models. A 200 means the key exists +
  // the v1beta API is reachable; per-model errors come later at use time.
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(token.trim())}`,
    )
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { models?: Array<{ name?: string }> }
      const imageCapable = (data.models ?? []).filter((m) =>
        (m.name ?? "").includes("image"),
      ).length
      return {
        ok: true,
        message: `Connected to Gemini (${data.models?.length ?? 0} models, ${imageCapable} image-capable)`,
      }
    }
    const text = await res.text().catch(() => "")
    return { ok: false, message: `Gemini HTTP ${res.status}: ${text.slice(0, 160) || res.statusText}` }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Connection failed" }
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
    case "slack": result = await testSlack(token); break
    case "google_drive": result = await testGoogleDrive(token); break
    case "fathom": result = await testFathom(token); break
    case "gemini": result = await testGemini(token); break
    default: return NextResponse.json({ ok: false, message: "Unknown service" })
  }

  // Update last_verified + is_valid in Supabase
  await supabase
    .from("api_tokens")
    .update({ is_valid: result.ok, last_verified: new Date().toISOString() })
    .eq("service", service)

  return NextResponse.json(result)
}
