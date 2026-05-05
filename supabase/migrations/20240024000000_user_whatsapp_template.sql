-- Per-AM WhatsApp template name registered in Trengo (e.g. `rl_universal_roel`).
--
-- WA outbound outside the 24h session window requires a Meta-approved
-- template. We register one per AM so the signature is baked into the
-- template (Meta forbids ending on a placeholder, so AM names can't be
-- variables). The AI fills the single `{{1}}` placeholder with
-- "{firstName}, {body}." — see the WA prompt in lib/inbox/automations.ts.
--
-- Empty / NULL means the AM has no template registered yet — the send-
-- endpoint will fall back to "send manually" with a friendly pointer.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS whatsapp_template_name TEXT;
