// Phase 0 probe — discover the exact Trengo API shapes we need for the
// composer parity work. Read-only where possible; writes (attachment
// upload) are non-destructive (no message gets sent to a customer).
//
// Run from repo root:
//   node scripts/probe-trengo.mjs
//
// Output: docs/trengo-audit.json (machine-readable). Use it to fill in
// docs/trengo-audit.md by hand once the responses come back.

import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { dirname } from "path"

// --- env ---------------------------------------------------------------
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=")
      return [l.slice(0, i), l.slice(i + 1).replace(/^"(.*)"$/, "$1")]
    }),
)

// --- decrypt system Trengo token --------------------------------------
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { data: row, error } = await supabase
  .from("api_tokens")
  .select("token_encrypted")
  .eq("service", "trengo")
  .single()
if (error || !row) {
  console.error("Failed to load Trengo token:", error)
  process.exit(1)
}
const [ivHex, tagHex, encryptedHex] = row.token_encrypted.split(":")
const decipher = crypto.createDecipheriv(
  "aes-256-gcm",
  Buffer.from(env.ENCRYPTION_KEY, "hex"),
  Buffer.from(ivHex, "hex"),
)
decipher.setAuthTag(Buffer.from(tagHex, "hex"))
const token = Buffer.concat([
  decipher.update(Buffer.from(encryptedHex, "hex")),
  decipher.final(),
])
  .toString("utf8")
  .trim()

const BASE = "https://app.trengo.com/api/v2"
const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" }

// --- helpers -----------------------------------------------------------
async function probeGet(label, path) {
  const url = `${BASE}${path}`
  process.stderr.write(`GET  ${path} ... `)
  try {
    const res = await fetch(url, { headers })
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch { body = text.slice(0, 500) }
    process.stderr.write(`${res.status}\n`)
    return { label, method: "GET", path, status: res.status, ok: res.ok, body, sample: sample(body) }
  } catch (e) {
    process.stderr.write(`ERROR ${e.message}\n`)
    return { label, method: "GET", path, error: e.message }
  }
}

async function probePostMultipart(label, path, formData) {
  const url = `${BASE}${path}`
  process.stderr.write(`POST ${path} (multipart) ... `)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      body: formData,
    })
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch { body = text.slice(0, 500) }
    process.stderr.write(`${res.status}\n`)
    return { label, method: "POST", path, status: res.status, ok: res.ok, body }
  } catch (e) {
    process.stderr.write(`ERROR ${e.message}\n`)
    return { label, method: "POST", path, error: e.message }
  }
}

/** Strip a deep response down to "what fields exist + first row's shape" so
 *  the audit doc stays readable. */
function sample(body) {
  if (!body || typeof body !== "object") return body
  if (Array.isArray(body)) {
    return {
      isArray: true,
      length: body.length,
      firstKeys: body[0] ? Object.keys(body[0]) : [],
      first: body[0],
    }
  }
  const keys = Object.keys(body)
  const out = { keys }
  if (Array.isArray(body.data)) {
    out.dataLength = body.data.length
    out.dataFirstKeys = body.data[0] ? Object.keys(body.data[0]) : []
    out.dataFirst = body.data[0]
  }
  return out
}

// --- probes ------------------------------------------------------------
const results = []

// 1. Identity check — confirm token works + see who the system token resolves to.
results.push(await probeGet("identity", "/users/me"))

// 2. Channels — full row schema. We need to know if email channels expose
//    a `signature` / `signature_html` field, or if we have to manage Hub-side.
results.push(await probeGet("channels", "/channels"))

// 3. Templates — Trengo's docs reference these paths interchangeably; try
//    each and see which 200s. The one that works tells us the canonical path.
results.push(await probeGet("templates_v1", "/wa_templates"))
results.push(await probeGet("templates_v2", "/whatsapp/templates"))
results.push(await probeGet("templates_v3", "/wab_templates"))
results.push(await probeGet("templates_v4", "/whatsapp_templates"))

// 4. Sample ticket — pick the most recent ticket and dump its full row so we
//    know which fields email tickets carry (subject, cc/bcc, from, etc.).
const tickets = await probeGet("recent_tickets", "/tickets?page=1")
results.push(tickets)
const sampleTicketId = tickets?.body?.data?.[0]?.id
if (sampleTicketId) {
  results.push(await probeGet("ticket_detail", `/tickets/${sampleTicketId}`))
  results.push(await probeGet("ticket_messages", `/tickets/${sampleTicketId}/messages?page=1`))
}

// 5. Attachment upload — non-destructive (creates a file in Trengo, doesn't
//    send a message). Use a 1x1 transparent PNG so the upload is tiny.
const onePxPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=",
  "base64",
)
const fd = new FormData()
fd.append("file", new Blob([onePxPng], { type: "image/png" }), "probe.png")
results.push(await probePostMultipart("attachment_upload_v1", "/attachments", fd))

// Try alternative attachment paths if the first 404s
const fd2 = new FormData()
fd2.append("file", new Blob([onePxPng], { type: "image/png" }), "probe.png")
results.push(await probePostMultipart("attachment_upload_v2", "/files", fd2))

// 6. WhatsApp business — discover related endpoints
results.push(await probeGet("wab_accounts", "/wa_business_accounts"))
results.push(await probeGet("wab_phones", "/wa_business_phone_numbers"))

// --- write output -------------------------------------------------------
const outPath = "docs/trengo-audit.json"
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(results, null, 2))
console.log(`\nWrote ${outPath}`)
console.log(`\nQuick summary:`)
for (const r of results) {
  const status = r.error ? `ERROR: ${r.error}` : `${r.status}${r.ok ? " ✓" : " ✗"}`
  console.log(`  ${r.method.padEnd(4)} ${r.path.padEnd(45)} ${status}`)
}
