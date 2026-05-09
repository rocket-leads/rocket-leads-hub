# Trengo API audit — Phase 0

> Verified by live probes against `https://app.trengo.com/api/v2/*` on 2026-05-09.
> Probe scripts: [scripts/probe-trengo.mjs](../scripts/probe-trengo.mjs) and follow-ups (-2 through -8).
> Raw responses cached in `docs/trengo-audit-*.json`.

The point of this doc: lock down the exact request/response shapes the composer parity work depends on, so Fase 1+ doesn't pivot mid-implementation on bad assumptions.

---

## Summary — what works, what doesn't

| Capability | Endpoint | Status | Notes |
|---|---|---|---|
| List channels (incl. signature) | `GET /channels` | ✅ Works | 28 email + 9 WhatsApp channels. Signature exposed per email channel. |
| List WhatsApp templates | `GET /wa_templates` | ✅ Works | 615 templates. Filterable by `channel_id`. |
| Upload file | `POST /attachments` (multipart) | ✅ Works | Returns `file_path` + `file_url`. **No `id` returned.** |
| Send text message | `POST /tickets/{id}/messages` | ✅ Works | Already used by Hub. `{ message, internal_note }`. |
| Send WhatsApp template | `POST /tickets/{id}/messages` | ✅ Works | Already used: `{ type: "TEMPLATE", template_name, language, params }`. |
| Send message with attachment | upload via `POST /ticket_draft_attachments` → send via `POST /tickets/{id}/messages` with `attachment_ids[]` | ✅ Works | Resolved via web-UI sniff. The PUBLIC `/attachments` endpoint returns no IDs; the working endpoint is `/ticket_draft_attachments` (also under `/api/v2/`, just undocumented). See "Attachments — solved" below. |
| Detect WhatsApp 24h window | (derive from `inbox_events` or `GET /tickets/{id}/messages`) | ✅ Works | Already implemented in [send-trengo-message/route.ts:314-327](../src/app/api/inbox/%5Bid%5D/send-trengo-message/route.ts#L314-L327) |

---

## What we already have (don't rebuild)

Two big pieces are already proven in the codebase from the C.5 work:

**1. WhatsApp template send.** [src/app/api/inbox/[id]/send-trengo-message/route.ts:158-197](../src/app/api/inbox/%5Bid%5D/send-trengo-message/route.ts#L158-L197) sends an HSM template via:
```json
POST /tickets/{ticketId}/messages
{
  "type": "TEMPLATE",
  "template_name": "rl_universal_roel",
  "language": "nl",
  "params": ["...substituted text..."],
  "internal_note": false
}
```
For Fase 2 we just need to wire a UI that picks a template and fills params.

**2. WhatsApp 24h session window detection.** [send-trengo-message/route.ts:314-327](../src/app/api/inbox/%5Bid%5D/send-trengo-message/route.ts#L314-L327) finds the latest `Contact`-authored message in a ticket, returns true if it's within 24h. Reuse as-is. Even cheaper: `inbox_events` has `created_at_src` for inbound — no Trengo round-trip needed.

---

## Channels — signature lives per email channel

`GET /channels` returns 54 entries. For email channels, `emailChannel.signature` is HTML and matches what Trengo's web UI uses on outbound. Example (Roy's "Roy Personal" email channel):

```json
{
  "id": 1339122,
  "type": "EMAIL",
  "title": "Roy Personal",
  "emailChannel": {
    "channel_id": 1339122,
    "sender_email": "...",
    "sender_name": "Rocket Leads",
    "sender_name_personal": "[agent.first_name] | Rocket Leads",
    "signature": "<p>Kind regards,<br /><br />[agent.first_name] [agent.last_name]<br />Rocket Leads</p>",
    "auto_reply_enabled": true,
    "auto_reply_subject": "Thank you for your email",
    "prepend_ticket_number_to_subject": false,
    "embed_attachments": false,
    "split_by_subject": true,
    "type": "TRENGO"
  }
}
```

**Implication for Fase 3:** we don't need a Hub-side `user_email_signatures` table. Pull `emailChannel.signature` directly per channel. Roy's setting in Trengo is the source of truth — one less thing to manage.

The signature contains `[agent.first_name]` etc. placeholders that Trengo substitutes server-side, so we should **NOT** substitute them in the Hub composer; let Trengo do it. The composer just shows them as literal placeholders in the preview, which is fine — they'll render correctly on send.

There are **28 email channels** (one per AM line, plus shared inboxes like `Email`, `arno`, `info`, etc.) and **9 WhatsApp channels**.

---

## WhatsApp templates

`GET /wa_templates` returns paginated list. Page 1 = 25 entries, total ~615 across all channels.

Shape per template:
```json
{
  "id": 226139,
  "title": "14days_postcall",
  "slug": "14days_postcall",
  "message": "Hey {{1}},\n\nHet is ondertussen 2 weken geleden dat we hebben gesproken. De laatste keer dat we elkaar spraken was je aan het focussen op het behalen van {{2}}. \n\nBen benieuwd, heb je dit doel ooit behaald of heb je dit opgegeven?",
  "channel_id": 1355422,
  "channels": [],
  "status": "ACCEPTED",
  "category": "MARKETING",
  "language": "nl",
  "labels": [],
  "components": [],
  "is_starred": false,
  "created_at": "2026-02-15T10:06:21+00:00"
}
```

With components (header / button):
```json
{
  "id": 176816,
  "title": "Afspraak Herinnering",
  "message": "Hi {{1}},\n\nMet dit bericht herinner ik je graag aan de afspraak vandaag met {{2}} van {{3}}.\n\nIk kijk alvast uit naar ons gesprek!\n\n...",
  "channel_id": 1333152,
  "language": "nl",
  "components": [
    { "id": 161546, "type": "HEADER", "sub_type": "TEXT", "value": "Afspraak Herinnering:", "details": null }
  ]
}
```

**Filter per channel:** filter on `channel_id === currentChannel.id`. (`channels[]` array is currently empty for all probed templates — only `channel_id` is reliable.)

**Status filter:** only show `status === "ACCEPTED"` in the picker (other statuses: `PENDING`, `REJECTED` — non-sendable).

**Variables:** `{{1}}`, `{{2}}`, etc. extracted via regex `/\{\{(\d+)\}\}/g`. Map to ordered `params: string[]` on send.

**Component types observed:** `HEADER` (TEXT/IMAGE), but most templates have empty `components: []`. Buttons not seen in probed sample but Trengo docs reference `BUTTONS` type — handle defensively.

**Caching:** templates rarely change. Cache the list for 5 minutes server-side keyed by channel id.

---

## Email message anatomy

OUTBOUND email message returned by `GET /tickets/{id}/messages`:

```json
{
  "id": 4244...,
  "ticket_id": 948353070,
  "type": "OUTBOUND",
  "body_type": "TEXT",
  "message": "...",
  "attachments": [],
  "email_message": {
    "id": 1245389224,
    "plain": null,
    "html": "<span style=\"font-size:13px; ...\"><p>Hi Niek...</p>...<div translate=\"no\" data-signature=\"true\"><p>Met vriendelijke groet...</div></span><blockquote ...>...quoted previous mail...</blockquote>",
    "to": "...",
    "cc": null,
    "from": "...",
    "subject": "...",
    "message_id": "...",
    "collapsed": false
  }
}
```

Key observations:
- **HTML body is fully formatted** — Trengo renders rich text, embedded images, signature blocks, quoted reply chains.
- **Signature is appended inline** to the HTML before send (`<div data-signature="true">...</div>`). The Hub composer should do the same: inject the channel's signature HTML at composer-open and let Roy edit on top.
- **Quoted previous mail** is a `<blockquote>` with `data-signature="true"` style markers — Trengo handles this natively when replying to an existing email ticket. We probably don't need to manage quoting; just send the new HTML and Trengo wraps the previous thread.
- **Subject lives on `email_message.subject`** but for replies-on-existing-tickets, Trengo handles "Re: ..." automatically. Custom subject only matters for net-new email threads (out of scope for Fase 3 since we always reply to existing tickets in the inbox).
- **`cc` field** is on `email_message`. Sending CC requires putting recipients on the OUTGOING send — confirmed possible in principle but field name on send side not yet probed (see open items).

---

## WhatsApp message anatomy

OUTBOUND WhatsApp template message:
```json
{
  "id": ...,
  "type": "OUTBOUND",
  "body_type": "COMPONENTS",
  "message": "Ha I, thx voor je aanvraag bij Founder Download...",
  "meta": {
    "hsm_id": 226430,
    "buttons": [],
    "footer": null,
    "header": null
  }
}
```

`body_type: "COMPONENTS"` is the marker for template-sent messages. `meta.hsm_id` references the template id.

Free-text WhatsApp messages: `body_type: "TEXT"`, `message` field carries the text directly. No `meta` template ref.

---

## Ticket / contact structure (relevant fields)

`GET /tickets?page=1` and `GET /tickets/{id}` return:

```json
{
  "id": 949312116,
  "status": "OPEN",
  "subject": "...",
  "contact_id": 535508514,
  "contact": { "id", "name", "full_name", "email", "phone", "display_name", ... },
  "channel": { "id", "name", "title", "type", "color", "display_name", "emailChannel": {...} or "whatsappChannel": {...} },
  "latest_message_at": "2026-05-09 07:07:05",
  "latest_received_message_at": "2026-05-09 07:07:05",
  "messages_count": 1,
  "labels": [...],
  "ai_assigned_at": null
}
```

`latest_received_message_at` is what we'd use for the 24h window if not deriving from `inbox_events`.

---

## Attachments — solved

The blocker turned out to be the wrong upload endpoint. Trengo exposes TWO upload paths under `/api/v2/`:

- `POST /api/v2/attachments` — accepts uploads, returns `{ file_path, file_url }` but **no `id`**. This is the one their public docs reference. It's effectively a dead end — its IDs aren't accepted by the message-send endpoint.
- `POST /api/v2/ticket_draft_attachments?channel_id=X&key=ticketN` — undocumented, but this is what their web UI actually uses. Returns a proper attachment record with **`id`**.

**Working flow (verified end-to-end):**

**1. Upload**
```
POST /api/v2/ticket_draft_attachments?channel_id={channelId}&key=ticket{ticketId}
Authorization: Bearer <token>
Content-Type: multipart/form-data

multipart fields:
  channel_id: "{channelId}"
  key: "ticket{ticketId}"
  file: <binary>
```

Returns 201 with:
```json
{
  "id": 407039382,
  "agency_id": 197824,
  "client_name": "original-name.png",
  "file_name": "<random-prefix>-original-name.png",
  "mime_type": "image/png",
  "size": null,
  "is_image": true,
  "extension": "PNG",
  "full_url": "https://trengo.s3.eu-central-1.amazonaws.com/media/...?<presigned>",
  "created_at": "...",
  "updated_at": "..."
}
```

**2. Send message with attachment**
```
POST /api/v2/tickets/{ticketId}/messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "your text",
  "internal_note": false,
  "attachment_ids": [407039382]
}
```

Returns 200; the resulting message has `attachments[0]` populated with the same shape we see on inbound attachment messages.

**Key field is `attachment_ids` (plural array of ints).** No `body_type` change needed — Trengo handles the rendering based on the attachment mime type.

**Notes for impl:**
- The `key` param is just a draft scoping namespace. `ticket{ticketId}` works; the web UI uses the same convention.
- Multiple files: upload each separately, collect all the IDs, send them in one `attachment_ids: [id1, id2, ...]` array.
- WhatsApp templates + attachments aren't currently supported in the same message — the template send uses `type: "TEMPLATE"` and won't accept `attachment_ids`. (Outside-window comms are template-only by Meta rules anyway.)
- Inside-window WhatsApp + attachment: works the same as email — `POST /tickets/{id}/messages` with `message` + `attachment_ids`.
- The presigned `full_url` from the upload response expires in 7 days. Don't store it client-side as a permanent reference; use the `id` for sends and re-fetch the message for display URLs.

---

## Endpoints that returned the SPA HTML (don't exist as API routes)

These are NOT real API endpoints — Trengo's frontend is served on the same domain and these paths return the SPA shell:

- `GET /users/me`
- `GET /whatsapp/templates`
- `GET /wab_templates`
- `GET /whatsapp_templates`
- `GET /wa_business_accounts`
- `GET /wa_business_phone_numbers`
- `GET /tickets/{id}/attachments`
- `GET /attachments`
- `GET /attachments/{id}`

The canonical alternatives are `GET /channels` (for users/identity infer), `GET /wa_templates` (for templates), and `GET /tickets/{id}/messages` for attachment data (attachments inline on messages).

---

## Ready-to-use building blocks for Fase 1+

| Need | Endpoint / pattern | Verified |
|---|---|---|
| List email channels with signatures | `GET /channels` → filter `type === "EMAIL"`, read `emailChannel.signature` | ✅ |
| List WhatsApp channels | `GET /channels` → filter `type` includes `WA` | ✅ |
| List templates for a channel | `GET /wa_templates?page=N` → filter by `channel_id` + `status === "ACCEPTED"` | ✅ |
| Send free text | `POST /tickets/{id}/messages` `{ message, internal_note }` | ✅ (already used) |
| Send template | `POST /tickets/{id}/messages` `{ type: "TEMPLATE", template_name, language, params, internal_note: false }` | ✅ (already used) |
| WhatsApp 24h window | derive from latest INBOUND `created_at_src` in `inbox_events` (no API call needed) | ✅ |
| Email subject (replies) | inherit from ticket — Trengo handles `Re: ` automatically | ✅ |
| Email CC / BCC | field exists on `email_message.cc` for received; send-side field name **needs probing at Fase 3** | ⚠️ |
| Send attachment | upload `POST /ticket_draft_attachments?channel_id=X&key=ticketN` (multipart) → message `POST /tickets/{id}/messages` with `attachment_ids: [<id>]` | ✅ |

---

## Updated phase plan (with audit findings)

All blockers cleared. No parallel spikes needed — attachments ship in Fase 1 alongside the composer shell.

**Fase 1 — Composer shell + attachments** ~1.5 dagen
- Channel-aware composer split (WhatsApp / Email / Generic)
- Attachment upload UI: drag-drop + file picker → `POST /ticket_draft_attachments` → store `id` array in composer state → include in `attachment_ids` on send
- Multi-file support, image preview, remove-before-send

**Fase 2 — WhatsApp parity** ~1.5 dagen
- Template-send endpoint + 24h window detection already exist in [send-trengo-message/route.ts](../src/app/api/inbox/%5Bid%5D/send-trengo-message/route.ts) — just expose to UI
- New: template picker (filter on `channel_id` + `status === "ACCEPTED"`), `{{1}}{{2}}` variable input UI, light markdown toolbar
- 24h banner derived from `inbox_events.created_at_src` (no API call)
- Inside-window: free text + attachments. Outside-window: template-only (no attachment per Meta rules).

**Fase 3 — Email parity** ~2.5 dagen
- Pull signature from `channels[].emailChannel.signature` (no Hub-side table needed)
- TipTap editor seeded with signature on composer-open; placeholders like `[agent.first_name]` left literal so Trengo substitutes server-side
- Subject inherits from ticket (Trengo handles `Re: `); only surface override field if needed later
- CC/BCC send-side field name: probe at impl time (~30 min)
- Attachments: same flow as Fase 1

---

## Open verifications for Fase 1+

Small unknowns resolvable during impl with single-shot probes. None block starting:

1. **Email CC/BCC on send.** The receive-side has `email_message.cc`. Send-side field name TBD — try `cc: ["..."]` first, then `cc_emails`, etc. Probe when implementing email composer.
2. **Email custom subject on reply.** Whether `subject: "..."` on `POST /tickets/{id}/messages` overrides the auto `Re: ` default. Probe when needed.
3. **Multi-variable WhatsApp templates** — when a template has 5 variables but the AM only supplies 3, what does Trengo do? Probably 422; verify with one test send.

---

*End of Phase 0 audit. All blockers cleared. Ready to start Fase 1.*
