// Phase 0 round 9 — DECISIVE: now that the web UI sniff revealed
// `POST /ticket_draft_attachments?channel_id=X&key=ticketN` returns a real
// attachment ID, retry the send with `attachment_ids: [<that id>]`. This
// should close the attachment loop.

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

// Use the same safe target as previous rounds (Github Actions notification ticket)
const TARGET_TICKET = 949312116
// Channel for that ticket — we noticed earlier it was channel id 1339122
// (Roy Personal email). Confirmed in the round-1 audit.
const TARGET_CHANNEL = 1339122

const onePxPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=",
  "base64",
)

// 1. Upload via the draft-attachments endpoint
const fd = new FormData()
fd.append("channel_id", String(TARGET_CHANNEL))
fd.append("key", `ticket${TARGET_TICKET}`)
fd.append("file", new Blob([onePxPng], { type: "image/png" }), "r9-decisive.png")

const uploadUrl = `${BASE}/ticket_draft_attachments?channel_id=${TARGET_CHANNEL}&key=ticket${TARGET_TICKET}`
console.error(`POST ${uploadUrl}`)
const upRes = await fetch(uploadUrl, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  body: fd,
})
const upBody = await upRes.json()
console.error("Upload status:", upRes.status)
console.error("Upload response:", JSON.stringify(upBody, null, 2))

if (!upRes.ok || !upBody.id) {
  console.error("Upload failed — abort")
  writeFileSync("docs/trengo-audit-9.json", JSON.stringify({ uploadFailed: true, upRes: upRes.status, upBody }, null, 2))
  process.exit(1)
}

const attachmentId = upBody.id
console.error(`\nGot attachment id: ${attachmentId}`)

// 2. Send message referencing that id via attachment_ids
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
  const attCount = mirror?.attachments?.length ?? 0
  console.error(`${label}: ${res.status} mirror[atts=${attCount}, file_url=${!!mirror?.file_url}, body_type=${mirror?.body_type}]`)
  if (!res.ok) console.error("  err:", JSON.stringify(resp).slice(0, 300))
  if (mirror?.attachments?.length) {
    console.error(`  ✓ ATTACHMENT WORKED. mirror.attachments[0]:`, JSON.stringify(mirror.attachments[0]).slice(0, 350))
  }
  return { label, status: res.status, body, response: resp, mirror }
}

const results = []
results.push(await send("attachment_ids_internal_note", {
  message: "Probe r9: attachment_ids = [draft_id]",
  internal_note: true,
  attachment_ids: [attachmentId],
}))

// Try without internal_note + with body_type
results.push(await send("attachment_ids_with_body_type_text", {
  message: "Probe r9: attachment_ids + body_type=TEXT",
  internal_note: true,
  body_type: "TEXT",
  attachment_ids: [attachmentId],
}))

writeFileSync("docs/trengo-audit-9.json", JSON.stringify({
  uploadResponse: upBody,
  attachmentId,
  results,
}, null, 2))
console.error("\nWrote docs/trengo-audit-9.json")
