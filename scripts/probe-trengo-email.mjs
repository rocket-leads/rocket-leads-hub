// Fase 3 probe — find Trengo's email-message send-side field names for
// CC/BCC/Subject/HTML body. Phase 0 audit confirmed they exist on the
// receive side (`email_message.cc`, `.subject`, `.html`); send side TBD.
//
// Safe target: an internal-team email ticket. We send all probes as
// internal_note=true so nothing reaches a customer.

import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"
import { readFileSync, writeFileSync } from "fs"

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=")
      return [l.slice(0, i), l.slice(i + 1).replace(/^"(.*)"$/, "$1")]
    }),
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { data: row } = await supabase
  .from("api_tokens")
  .select("token_encrypted")
  .eq("service", "trengo")
  .single()
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
const TARGET_TICKET = 949312116 // safe GitHub Actions notification (EMAIL channel)

async function send(label, body) {
  const res = await fetch(`${BASE}/tickets/${TARGET_TICKET}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let resp
  try { resp = JSON.parse(text) } catch { resp = text.slice(0, 300) }
  const msgId = resp?.message?.id ?? resp?.id
  let mirror = null
  if (msgId) {
    await new Promise((r) => setTimeout(r, 700))
    const msgs = await fetch(`${BASE}/tickets/${TARGET_TICKET}/messages?page=1`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    }).then((r) => r.json())
    mirror = (msgs.data ?? []).find((m) => String(m.id) === String(msgId))
  }
  const em = mirror?.email_message
  console.error(`${label}: ${res.status}${res.ok ? " ✓" : ""}`)
  if (!res.ok) console.error("  err:", JSON.stringify(resp).slice(0, 250))
  if (em) {
    console.error(`  email_message: subject="${em.subject ?? ""}" cc=${JSON.stringify(em.cc)} bcc=${JSON.stringify(em.bcc)} html_first120=${(em.html ?? "").slice(0, 120)}`)
  } else if (mirror) {
    console.error(`  body_type=${mirror.body_type} message=${(mirror.message ?? "").slice(0, 80)}`)
  }
  return { label, status: res.status, body, response: resp, mirror }
}

const results = []

// 1. HTML body — does Trengo accept it for email?
results.push(await send("html_body_field", {
  message: "<p>Hi <strong>there</strong>, this is <em>HTML</em>!</p>",
  internal_note: true,
}))

// 2. Try `html` field separately
results.push(await send("html_top_level_field", {
  message: "Plain fallback",
  html: "<p>Hi <strong>there</strong>, this is <em>HTML</em> via the html field!</p>",
  internal_note: true,
}))

// 3. CC field — array of strings
results.push(await send("cc_array_strings", {
  message: "Probe CC array",
  internal_note: true,
  cc: ["test+cc@rocketleads.com"],
}))

// 4. CC as comma-separated string
results.push(await send("cc_string", {
  message: "Probe CC string",
  internal_note: true,
  cc: "test+ccstr@rocketleads.com",
}))

// 5. CC as cc_emails
results.push(await send("cc_emails_field", {
  message: "Probe cc_emails array",
  internal_note: true,
  cc_emails: ["test+ccfield@rocketleads.com"],
}))

// 6. BCC field
results.push(await send("bcc_array_strings", {
  message: "Probe BCC",
  internal_note: true,
  bcc: ["test+bcc@rocketleads.com"],
}))

// 7. Subject override
results.push(await send("subject_override", {
  message: "Probe subject override",
  internal_note: true,
  subject: "Custom subject from probe",
}))

// 8. Combined: subject + html + cc + bcc
results.push(await send("combined_email_fields", {
  message: "Combined fallback",
  internal_note: true,
  html: "<p>Hi <strong>combined</strong> probe</p>",
  subject: "Combined subject probe",
  cc: ["test+cc-combined@rocketleads.com"],
  bcc: ["test+bcc-combined@rocketleads.com"],
}))

writeFileSync("docs/trengo-audit-email.json", JSON.stringify(results, null, 2))
console.error("\nWrote docs/trengo-audit-email.json")
