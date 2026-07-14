-- Drop the weekly_update_drafts table.
--
-- The Monday-morning "weekly update queue" (a cron that pre-staged a draft
-- per Live client + a separate queue window in the navbar) has been removed.
-- The weekly update now runs entirely through the per-row "Update" button
-- on the clients table: it composes the same update on-demand via
-- /api/clients/[id]/client-update, sends via Trengo, and the "Client update"
-- column shows the "Deze week verstuurd" state driven by clients.last_client_update_at.
--
-- This table only ever held transient drafts (pending/sent/dismissed), so
-- dropping it loses no durable data. The audit trail (client_updates +
-- clients.last_client_update_at) is untouched.
--
-- The ad-hoc mid-week Co-pilot update (kind='midweek') that also upserted
-- here was removed in the same change.

DROP TABLE IF EXISTS public.weekly_update_drafts CASCADE;

NOTIFY pgrst, 'reload schema';
