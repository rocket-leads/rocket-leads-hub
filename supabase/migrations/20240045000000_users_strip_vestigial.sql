-- Strip vestigial per-user columns from `users`.
--
-- Both columns landed in the original outbound-channel work but stopped
-- pulling their weight quickly:
--
--   - `whatsapp_template_name` was the AM's HSM template slug back when
--     `resolveWaTemplate` consulted it first. After the convention move
--     (slug derived from `users.name` first token + a small hardcoded
--     override map in `src/lib/clients/resolve-wa-template.ts`) the
--     column has had zero readers — verified by grep before this
--     migration. Editing the input in Settings did nothing.
--
--   - `test_trengo_contact_id` was the persisted "test send recipient"
--     per user. Roy flagged it as overkill: test sends happen rarely,
--     pre-creating a Trengo contact and pasting its id per AM is more
--     plumbing than the use-case warrants. Replaced by an ad-hoc input
--     pair in the send dialog (email / phone), persisted client-side
--     via localStorage so the AM doesn't retype every session, but
--     never stored server-side.
--
-- No data preserved — the WhatsApp template column was unused and the
-- test contact column landed a day ago.

ALTER TABLE users
  DROP COLUMN IF EXISTS whatsapp_template_name,
  DROP COLUMN IF EXISTS test_trengo_contact_id;
