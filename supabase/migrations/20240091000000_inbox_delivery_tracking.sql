-- Delivery tracking for internal tasks/updates so the CREATOR can see whether
-- what they delegated actually went out and got picked up.
--
-- Until now listInboxItems hard-scoped tasks/updates to assignee_id = me, so an
-- item you authored for someone else was delivered (lands in their inbox + push)
-- but invisible to you. The new Delegated view surfaces those; these two columns
-- give it a real delivery signal instead of guessing from status alone:
--
--   notified_at - stamped when the assignee push is confirmed sent (delivered>0)
--                 on create, and re-stamped on reassign. Tasks only (updates
--                 don't push); null = not yet delivered.
--   seen_at     - stamped the first time the assignee opens/reads the item
--                 (GET detail as assignee, or marking read/done). null = not
--                 yet seen by the recipient.
--
-- Roy 2026-07-30.

alter table inbox_events add column if not exists notified_at timestamptz;
alter table inbox_events add column if not exists seen_at timestamptz;

notify pgrst, 'reload schema';
