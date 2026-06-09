-- Backfill: mark already-ingested Trengo OUTBOUND / NOTE rows as read.
--
-- The Trengo webhook used to insert every chat row (inbound, outbound,
-- internal note) with status='unread'. That meant every reply the team
-- sent themselves polluted the "Nieuwe inbox" / Now feed as a fresh
-- unread item — Roy was seeing his own outbound WhatsApp replies show
-- up as inbox tickets to action. The ingest is now fixed
-- (src/app/api/webhooks/trengo/route.ts) so only client-authored
-- INBOUND messages land as unread. This migration cleans up the
-- pre-existing rows so the badge counts immediately settle.
--
-- Safe: we only flip status from 'unread' to 'read' on chat-substrate
-- rows we ourselves authored. No client-authored messages are touched.

UPDATE inbox_events
SET status = 'read'
WHERE source = 'trengo'
  AND kind = 'chat'
  AND status = 'unread'
  AND author_kind = 'rl_team';
